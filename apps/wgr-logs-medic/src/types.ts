export interface Problem {
  id: number
  project: string
  signature: string
  patternHash: string | null
  tech: string | null
  category: string
  file: string | null
  line: number | null
  sample: string
  count: number
  fixabilityScore: number
  status: string
}

export type RemediationStatus = 'open' | 'fixing' | 'pr_open' | 'needs_input' | 'changes_requested' | 'merged' | 'wontfix'

export interface Remediation {
  id: number
  problemId: number
  repo: string
  branch: string | null
  prUrl: string | null
  prNumber: number | null
  sessionId: string | null
  status: RemediationStatus
  costUsd: number
  summary: string | null
  diffStat: string | null
  notVerified: string | null
}

export interface ProjectContext {
  id: number
  repo: string
  tech: string | null
  summary: string
}

export interface ParsedError {
  /** Stable hash identifying recurring occurrences of the same error. */
  signature: string
  /** e.g. "Error", "Warning", "Notice". */
  category: string
  /** Exception class if present, e.g. "Cake\\View\\Exception\\MissingHelperException". */
  exceptionClass?: string
  /** Source file the error points at, if any. */
  file?: string
  /** 1-based line number in `file`, if any. */
  line?: number
  /** Message with volatile bits normalized (numbers, quoted strings, paths). */
  template: string
  /** Project-agnostic hash (category + exceptionClass + templated message, NO file path) for cross-project matching. */
  patternHash: string
}

export interface ProblemCandidate {
  signature: string
  patternHash: string
  tech?: string
  category: string
  file?: string
  line?: number
  sample: string
  count: number
  fixabilityScore: number
}
