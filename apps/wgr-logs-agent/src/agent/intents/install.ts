import type { TaskBrief } from '../types.js'

export function installPrompt(brief: TaskBrief): string {
  const t = brief.target
  return [
    `Install and enrol the wgr-logs shipper on target "${t.name}" (kind=${t.kind}, host=${t.ssh.host}).`,
    'Follow the install procedure for this shipper kind from the docs.',
    'Idempotence: before registering, call the admin API to list agents and reuse an existing one matching this name/hostname instead of creating a duplicate.',
    'When registering, map the target kind to the API shipper_kind (php-mutu → php).',
    `Finish by verifying logs for host "${t.name}" reach Loki (count_over_time over the last 5m must be > 0).`,
  ].join(' ')
}
