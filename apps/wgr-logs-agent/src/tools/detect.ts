import type { SourceType } from './types.js'

/**
 * Read-only inventory probe. It makes NO assumption about the server's layout —
 * it reports (a) standard box-level services at stable locations and (b) where
 * `*.log` files actually live. The agent then reasons over this inventory and
 * proposes `files` globs adapted to THIS server (it is the config function);
 * we don't hardcode any client/env/app structure here.
 *
 * Emits TSV lines:
 *   svc\t<kind>\t<detail>      journald | nginx | apache | docker | pm2
 *   logdir\t<dir>\t<count>     a directory containing <count> *.log files
 * Bounded (maxdepth + prune vendor/node_modules + head) to stay cheap.
 */
export const DETECT_SCRIPT = `
J=
[ -d /var/log/journal ] && J=persistent
[ -z "$J" ] && [ -d /run/log/journal ] && J=volatile
[ -n "$J" ] && printf 'svc\\tjournald\\t%s\\n' "$J"
[ -d /var/log/nginx ] && ls /var/log/nginx/*.log >/dev/null 2>&1 && printf 'svc\\tnginx\\t\\n'
[ -d /var/log/apache2 ] && ls /var/log/apache2/*.log >/dev/null 2>&1 && printf 'svc\\tapache\\t\\n'
command -v docker >/dev/null 2>&1 && printf 'svc\\tdocker\\t%s\\n' "$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
for p in /home/*/.pm2/logs /root/.pm2/logs; do [ -d "$p" ] && printf 'svc\\tpm2\\t%s\\n' "$p"; done 2>/dev/null
for root in /var/www /srv /opt /home /data /data01; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 6 \\( -name node_modules -o -name vendor -o -name .git -o -name .cache \\) -prune \\
    -o -type f -name '*.log' -print 2>/dev/null \\
    | sed 's#/[^/]*$##' | sort | uniq -c | sort -rn | head -60 \\
    | while read -r cnt dir; do printf 'logdir\\t%s\\t%s\\n' "$dir" "$cnt"; done
done
`.trim()

export interface CandidateSource {
  type: SourceType
  config: Record<string, unknown>
  reason: string
}

export interface LogDir {
  dir: string
  count: number
}

export interface Inventory {
  /** Ready-to-create box-level sources (stable locations). */
  services: CandidateSource[]
  /** Raw log-file directories with counts — the agent turns these into `files` globs. */
  logDirs: LogDir[]
}

/** Pure parser: detection stdout → inventory (no structure assumptions, no globbing). */
export function parseInventory(stdout: string): Inventory {
  const services: CandidateSource[] = []
  const logDirs: LogDir[] = []

  for (const raw of stdout.split('\n')) {
    const parts = raw.split('\t')
    if (parts[0] === 'svc') {
      const kind = parts[1]
      const detail = parts[2] ?? ''
      if (kind === 'journald') services.push({ type: 'journald', config: {}, reason: `systemd journal (${detail || 'present'})` })
      else if (kind === 'nginx') services.push({ type: 'nginx', config: {}, reason: '/var/log/nginx logs present' })
      else if (kind === 'apache') services.push({ type: 'files', config: { paths: ['/var/log/apache2/*.log'] }, reason: 'Apache logs in /var/log/apache2' })
      else if (kind === 'docker')
        services.push({
          type: 'docker',
          config: {},
          reason: `docker present (${detail || '?'} running containers) — captures all container & compose logs via the socket`,
        })
      else if (kind === 'pm2' && detail) services.push({ type: 'pm2', config: { path: detail }, reason: `pm2 logs at ${detail}` })
    } else if (parts[0] === 'logdir' && parts[1]) {
      const count = Number.parseInt(parts[2] ?? '0', 10)
      logDirs.push({ dir: parts[1], count: Number.isFinite(count) ? count : 0 })
    }
  }

  return { services, logDirs }
}
