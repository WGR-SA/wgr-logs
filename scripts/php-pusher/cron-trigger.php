<?php
/**
 * cron-trigger.php — URL-triggered wrapper for wgr-logs-push.php.
 *
 * Placed in the public web root of a shared host whose cron scheduler only
 * accepts URLs (e.g. Infomaniak mutu). The real pusher script + config stay
 * outside the docroot.
 *
 * Layout :
 *   ~/wgr-logs/
 *     wgr-logs-push.php
 *     config.json
 *     .env                       # contains WGR_INGEST_TOKEN=...
 *     .cron-token                # contains a single secret string (no newline)
 *     .state/
 *   ~/sites/<your-site>/public_html/wgr-logs-cron.php  ← this file (renamed)
 *
 * URL to plug into the Infomaniak cron scheduler :
 *   https://<your-site>/wgr-logs-cron.php?token=<contents of .cron-token>
 */

declare(strict_types=1);

// ─── Resolve the wgr-logs directory ────────────────────────────────
// Adapt this if your layout differs. Default assumes
// ~/sites/<host>/public_html/wgr-logs-cron.php → ../../../wgr-logs.
$WGR_LOGS_DIR = getenv('WGR_LOGS_DIR')
    ?: dirname(__DIR__, 3) . '/wgr-logs';

if (!is_dir($WGR_LOGS_DIR)) {
    http_response_code(500);
    exit("wgr-logs dir not found at $WGR_LOGS_DIR — set WGR_LOGS_DIR env or edit this file");
}

// ─── Token check ───────────────────────────────────────────────────
$tokenFile = $WGR_LOGS_DIR . '/.cron-token';
$expected  = is_file($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';
$given     = (string) ($_GET['token'] ?? '');

if ($expected === '' || !hash_equals($expected, $given)) {
    http_response_code(403);
    exit('forbidden');
}

// ─── Long-running OK ───────────────────────────────────────────────
set_time_limit(0);
ignore_user_abort(true);
header('Content-Type: text/plain');

// ─── Load .env so WGR_INGEST_TOKEN is exposed ──────────────────────
$envFile = $WGR_LOGS_DIR . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        if ($line === '' || $line[0] === '#') continue;
        if (!str_contains($line, '=')) continue;
        [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
        $v = trim($v, " \t\"'");
        putenv("$k=$v");
    }
}

// ─── Exec the real pusher (proc_open with array args = no shell) ───
$phpBin = getenv('PHP_BIN') ?: 'php';
$cmd = [
    $phpBin,
    $WGR_LOGS_DIR . '/wgr-logs-push.php',
    $WGR_LOGS_DIR . '/config.json',
];

$descriptors = [
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
];

$start = microtime(true);
$proc = proc_open($cmd, $descriptors, $pipes);

if (!is_resource($proc)) {
    http_response_code(500);
    exit("failed to start php cli ($phpBin)");
}

$stdout = stream_get_contents($pipes[1]); fclose($pipes[1]);
$stderr = stream_get_contents($pipes[2]); fclose($pipes[2]);
$rc = proc_close($proc);

$elapsed = round(microtime(true) - $start, 1);
$lastRun = $WGR_LOGS_DIR . '/.state/last-run.json';
$report  = is_file($lastRun) ? file_get_contents($lastRun) : '(no last-run.json)';

echo "exit={$rc} in {$elapsed}s\n\n";
if ($stdout !== '' && $stdout !== false) echo "--- stdout ---\n$stdout\n";
if ($stderr !== '' && $stderr !== false) echo "--- stderr ---\n$stderr\n";
echo "--- last-run.json ---\n$report\n";
