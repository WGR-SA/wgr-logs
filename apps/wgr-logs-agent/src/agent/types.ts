import type { Target } from '../config/targets.js'

export type Intent = 'install' | 'refresh' | 'diagnose' | 'repair'

export const REPAIR_ISSUES = [
  'stale-offsets',
  'disabled-agent',
  'rotate-cron-token',
  '429-rate-limit',
  'grpc-msg-too-large',
] as const
export type RepairIssue = (typeof REPAIR_ISSUES)[number]

export interface IntentFlags {
  dryRun: boolean
  yes: boolean
  model?: string
  /** Required for `repair`. */
  issue?: RepairIssue
}

export interface TaskBrief {
  intent: Intent
  target: Target
  flags: IntentFlags
}

export interface RunResult {
  resultText: string
  isError: boolean
  numTurns: number
}
