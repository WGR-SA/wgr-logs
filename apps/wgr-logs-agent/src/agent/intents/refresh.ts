import type { TaskBrief } from '../types.js'

export function refreshPrompt(brief: TaskBrief): string {
  const t = brief.target
  return [
    `Refresh the wgr-logs shipper assets on target "${t.name}" (kind=${t.kind}, host=${t.ssh.host}).`,
    'Compare the local worktree copy of the shipper scripts (sha256) against the remote copies and upload only what changed.',
    'Then validate (php -l for php-mutu) or reload the service, trigger one push cycle, and report the diffs plus the new last-run.json.',
  ].join(' ')
}
