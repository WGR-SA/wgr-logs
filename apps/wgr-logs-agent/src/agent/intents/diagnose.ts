import type { TaskBrief } from '../types.js'

export function diagnosePrompt(brief: TaskBrief): string {
  const t = brief.target
  return [
    `Diagnose the wgr-logs shipper for target "${t.name}" (kind=${t.kind}, host=${t.ssh.host}). This is read-only — do not change anything.`,
    'Gather: the agent record and its sources from the admin API, the latest config version, the last-run state, and a Loki count_over_time for this host over the last 15m.',
    'For php-mutu, also inspect the remote ~/wgr-logs/.state and last-run file.',
    'Summarize the most likely root-cause candidates and the evidence for each.',
  ].join(' ')
}
