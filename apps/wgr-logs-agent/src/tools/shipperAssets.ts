import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError } from '../lib/errors.js'

/** Canonical paths to the repo artifacts the agent uploads / reasons about. No copies, no embeds. */

export function findRepoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'scripts', 'install-shipper.sh'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new ConfigError('Could not locate the wgr-logs repo root (scripts/install-shipper.sh not found).')
}

export interface ShipperAssets {
  installScript: string
  phpPusher: string
  phpCronTrigger: string
  phpConfigExample: string
  dockerComposeManaged: string
}

export function shipperAssets(repoRoot: string): ShipperAssets {
  return {
    installScript: join(repoRoot, 'scripts/install-shipper.sh'),
    phpPusher: join(repoRoot, 'scripts/php-pusher/wgr-logs-push.php'),
    phpCronTrigger: join(repoRoot, 'scripts/php-pusher/cron-trigger.php'),
    phpConfigExample: join(repoRoot, 'scripts/php-pusher/config.example.json'),
    dockerComposeManaged: join(repoRoot, 'apps/wgr-logs-shipper/examples/docker-compose.managed.yml'),
  }
}

/** Docs loaded into the system prompt (only those that exist are returned). */
export function docBundlePaths(repoRoot: string): string[] {
  const candidates = [
    'docs/architecture.md',
    'docs/api.md',
    'docs/runbook.md',
    'docs/mutu-runbook.md',
    'docs/shipper-bash.md',
    'docs/shipper-docker.md',
    'docs/shipper-php.md',
  ].map((p) => join(repoRoot, p))
  return candidates.filter((p) => existsSync(p))
}
