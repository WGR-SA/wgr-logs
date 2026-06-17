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
}

export interface ProblemCandidate {
  signature: string
  category: string
  file?: string
  line?: number
  sample: string
  count: number
  fixabilityScore: number
}
