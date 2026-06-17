import type { Problem, Remediation } from '../types.js'

const HANDLED = new Set(['fixing', 'pr_open', 'needs_input', 'changes_requested', 'merged', 'wontfix'])

/** The easiest unhandled problem: highest fixabilityScore (tie: count), excluding any with an active/terminal remediation. */
export function selectNext(problems: readonly Problem[], remediations: readonly Remediation[]): Problem | null {
  const handled = new Set(remediations.filter((r) => HANDLED.has(r.status)).map((r) => r.problemId))
  const candidates = problems
    .filter((p) => !handled.has(p.id))
    .sort((a, b) => b.fixabilityScore - a.fixabilityScore || b.count - a.count)
  return candidates[0] ?? null
}
