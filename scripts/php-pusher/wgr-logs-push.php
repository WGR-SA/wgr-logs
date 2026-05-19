<?php
/**
 * wgr-logs-push.php — shipper PHP pour hébergement mutualisé.
 *
 * Lit un fichier de config JSON, scanne les sources via glob, lit
 * incrémentalement les nouveaux logs (offset par fichier), et pousse
 * vers Loki via HTTPS Basic Auth.
 *
 * Conçu pour PHP 7.4+. Pas de daemon, à lancer via cron.
 *
 * Usage :
 *   php wgr-logs-push.php /path/to/config.json
 *
 * Cron :
 *   * /5 * * * * /usr/bin/php /home/user/wgr-logs/wgr-logs-push.php \
 *     /home/user/wgr-logs/config.json >> /dev/null 2>&1
 */

declare(strict_types=1);

// ─── Bootstrap ─────────────────────────────────────────────────────
$configPath = $argv[1] ?? null;
if (!$configPath || !file_exists($configPath)) {
    fwrite(STDERR, "Usage: php wgr-logs-push.php <config.json>\n");
    exit(1);
}

$config = json_decode((string) file_get_contents($configPath), true);
if (!is_array($config)) {
    fwrite(STDERR, "Invalid JSON config: $configPath\n");
    exit(1);
}

// ─── Validate config ───────────────────────────────────────────────
$ingestUrl   = $config['ingest']['url']  ?? 'https://ingest.example.com/loki/api/v1/push';
$ingestUser  = $config['ingest']['user'] ?? 'wgr';
$tokenEnv    = $config['ingest']['token_env'] ?? 'WGR_INGEST_TOKEN';
$ingestToken = getenv($tokenEnv) ?: '';

if ($ingestToken === '') {
    fwrite(STDERR, "Missing env var $tokenEnv (ingest token)\n");
    exit(1);
}

$defaults = $config['defaults'] ?? [];
$env      = $defaults['env']      ?? 'prod';
$cluster  = $defaults['cluster']  ?? 'wgr-prod';
$host     = $defaults['host']     ?? (gethostname() ?: 'unknown');

$sources  = $config['sources']  ?? [];
$stateDir = $config['state_dir'] ?? dirname($configPath) . '/.state';

if (!is_dir($stateDir)) {
    if (!@mkdir($stateDir, 0700, true) && !is_dir($stateDir)) {
        fwrite(STDERR, "Cannot create state_dir: $stateDir\n");
        exit(1);
    }
}

// ─── Locking (avoid overlap if cron runs while previous still going) ─
$lockFile = $stateDir . '/.lock';
$lockFp = fopen($lockFile, 'c');
if ($lockFp === false || !flock($lockFp, LOCK_EX | LOCK_NB)) {
    exit(0);
}

// ─── Process each source ───────────────────────────────────────────
$totalLines = 0;
$totalFiles = 0;
$errors     = [];

foreach ($sources as $source) {
    $type = $source['type'] ?? 'files';
    $glob = $source['glob'] ?? null;
    if (!$glob) {
        $errors[] = "Source missing 'glob' field: " . json_encode($source);
        continue;
    }

    $appRegex = $source['app_from_path'] ?? null;
    $files = glob($glob, GLOB_BRACE) ?: [];

    foreach ($files as $file) {
        if (!is_file($file) || !is_readable($file)) continue;

        $app = extractApp($file, $appRegex, $source['app'] ?? null);
        $stream = [
            'app'     => $app,
            'env'     => $env,
            'host'    => $host,
            'source'  => $type,
        ];

        foreach ($source['labels'] ?? [] as $k => $v) {
            $stream[$k] = (string) $v;
        }

        try {
            $batches = readIncremental(
                $file,
                $stateDir,
                $stream,
                $source['multiline_start'] ?? null,
                $source['level_from_msg'] ?? null
            );
            if ($batches !== null && !empty($batches)) {
                // Split by byte budget — Loki's gRPC server caps each push at 16 MiB by config,
                // 4 MiB by default. Keep well under either.
                foreach (chunkByBytes($batches, 2_500_000) as $chunk) {
                    pushBatch($ingestUrl, $ingestUser, $ingestToken, $chunk);
                }
                foreach ($batches as $b) $totalLines += count($b['values']);
                $totalFiles++;
                commitOffset($file, $stateDir);
            }
        } catch (\Throwable $e) {
            $errors[] = $file . ': ' . $e->getMessage();
        }
    }
}

file_put_contents(
    $stateDir . '/last-run.json',
    json_encode([
        'at'           => date('c'),
        'host'         => $host,
        'lines_pushed' => $totalLines,
        'files_with_data' => $totalFiles,
        'errors'       => $errors,
    ], JSON_PRETTY_PRINT) . "\n"
);

flock($lockFp, LOCK_UN);
fclose($lockFp);

if (!empty($errors)) {
    fwrite(STDERR, implode("\n", $errors) . "\n");
    exit(2);
}

exit(0);


// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Read new content from $file and return one or more Loki streams.
 *
 *   $multilineStart : optional regex (PCRE delimited, e.g. '#^\d{4}-\d{2}-\d{2}#').
 *     When set, accumulate lines until the next line matches → 1 multi-line entry per match.
 *
 *   $levelFromMsg : optional assoc array { "regex" => "level" } applied to each entry's msg
 *     (first match wins). Used to split a single file into per-level streams.
 *     Example: { "Error:|Fatal error" => "error", "Warning:" => "warn" }
 *
 * Returns an array of Loki stream payloads (one per detected level), or null if nothing new.
 */
function readIncremental(
    string $file,
    string $stateDir,
    array $stream,
    ?string $multilineStart = null,
    ?array $levelFromMsg = null
): ?array {
    $offsetFile = $stateDir . '/' . hashPath($file) . '.offset';
    $committed  = file_exists($offsetFile) ? (int) trim((string) file_get_contents($offsetFile)) : 0;

    $size = filesize($file);
    if ($size === false) return null;

    if ($size < $committed) {
        $committed = 0;
    }
    if ($size === $committed) {
        return null;
    }

    $fp = fopen($file, 'rb');
    if ($fp === false) return null;
    if ($committed > 0) fseek($fp, $committed);

    // Group raw lines into entries (multi-line aware).
    $entries = [];
    $current = null;
    $newOffset = $committed;
    $maxEntries = 5000;

    while (($line = fgets($fp)) !== false) {
        $newOffset = ftell($fp);
        $line = rtrim($line, "\r\n");

        if ($multilineStart === null) {
            if ($line === '') continue;
            $entries[] = $line;
            if (count($entries) >= $maxEntries) break;
        } else {
            $isStart = preg_match($multilineStart, $line) === 1;
            if ($isStart) {
                if ($current !== null) {
                    $entries[] = $current;
                    if (count($entries) >= $maxEntries) { $current = null; break; }
                }
                $current = $line;
            } else {
                if ($current === null) {
                    // Orphan continuation line at start of read window: emit as a standalone entry.
                    if ($line !== '') $entries[] = $line;
                } else {
                    $current .= "\n" . $line;
                }
            }
        }
    }
    if ($current !== null) $entries[] = $current;
    fclose($fp);

    file_put_contents($offsetFile . '.pending', (string) $newOffset);

    if (empty($entries)) return null;

    // Bucket entries by detected level.
    $byLevel = [];  // level => values[]
    $ts = (int) (microtime(true) * 1_000_000_000);
    foreach ($entries as $msg) {
        $level = detectLevel($msg, $levelFromMsg);
        $byLevel[$level] ??= [];
        $byLevel[$level][] = [(string) $ts, $msg];
        $ts++;
    }

    // One Loki stream per level, with the `level` label set.
    $batches = [];
    foreach ($byLevel as $level => $values) {
        $s = $stream;
        $s['level'] = $level;
        $batches[] = ['stream' => $s, 'values' => $values];
    }
    return $batches;
}

/**
 * Yield chunks of $batches whose cumulative msg payload stays under $maxBytes.
 * Each chunk is a valid array of Loki stream payloads. A single oversized entry
 * still ships as its own chunk (Loki may reject it, but we prefer that to a silent drop).
 */
function chunkByBytes(array $batches, int $maxBytes): iterable {
    $pending = [];          // stream-key => ['stream' => ..., 'values' => [...]]
    $size = 0;

    foreach ($batches as $b) {
        $key = json_encode($b['stream']);
        foreach ($b['values'] as $v) {
            $vSize = strlen($v[1]) + 40;  // payload + JSON overhead estimate
            if ($size + $vSize > $maxBytes && $size > 0) {
                yield array_values($pending);
                $pending = [];
                $size = 0;
            }
            if (!isset($pending[$key])) {
                $pending[$key] = ['stream' => $b['stream'], 'values' => []];
            }
            $pending[$key]['values'][] = $v;
            $size += $vSize;
        }
    }
    if (!empty($pending)) yield array_values($pending);
}

function detectLevel(string $msg, ?array $rules): string {
    if (!$rules) return 'info';
    foreach ($rules as $regex => $level) {
        // Accept both already-delimited regexes and plain alternations.
        $pattern = (strlen($regex) > 0 && $regex[0] === '#') ? $regex : '#' . $regex . '#i';
        if (preg_match($pattern, $msg) === 1) return $level;
    }
    return 'info';
}

function commitOffset(string $file, string $stateDir): void {
    $offsetFile = $stateDir . '/' . hashPath($file) . '.offset';
    $pending    = $offsetFile . '.pending';
    if (file_exists($pending)) {
        rename($pending, $offsetFile);
    }
}

function hashPath(string $file): string {
    return substr(sha1($file), 0, 16);
}

function extractApp(string $file, ?string $regex, ?string $fallback): string {
    if ($regex) {
        if (preg_match($regex, $file, $m) === 1 && isset($m[1])) {
            return $m[1];
        }
    }
    return $fallback ?: basename(dirname($file));
}

function pushBatch(string $url, string $user, string $token, array $streams): void {
    // JSON_INVALID_UTF8_SUBSTITUTE : remplace les bytes mal encodés par U+FFFD au lieu d'échouer.
    // Apps qui logent en latin-1 / windows-1252 ou contenant des caractères corrompus ne cassent plus le batch.
    $payload = json_encode(
        ['streams' => $streams],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    if ($payload === false) {
        throw new \RuntimeException('Failed to encode payload: ' . json_last_error_msg());
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode($user . ':' . $token),
        ],
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FAILONERROR    => false,
    ]);

    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($code === 0) {
        throw new \RuntimeException('Network error: ' . $err);
    }
    if ($code < 200 || $code >= 300) {
        throw new \RuntimeException("HTTP $code from Loki: " . substr((string) $body, 0, 200));
    }
}
