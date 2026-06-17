import { ConfigError } from '../../lib/errors.js'
import { REPAIR_ISSUES, type TaskBrief } from '../types.js'

export function repairPrompt(brief: TaskBrief): string {
  const t = brief.target
  const issue = brief.flags.issue
  if (!issue) {
    throw new ConfigError(`repair requires --issue <${REPAIR_ISSUES.join('|')}>`)
  }
  return [
    `Repair issue "${issue}" on target "${t.name}" (kind=${t.kind}, host=${t.ssh.host}).`,
    'Follow the deterministic steps for this issue from the docs. Diagnose first to confirm the issue is present, propose the fix, and apply it only after confirmation (mutations are gated).',
    'Report what you changed and the verification result.',
  ].join(' ')
}
