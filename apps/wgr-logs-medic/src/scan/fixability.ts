import type { ParsedError } from '../types.js'

export interface Fixability {
  score: number
  reason: string
}

const INFRA = /\b(timed out|timeout|connection|refused|deadlock|SQLSTATE|out of memory|allowed memory|segmentation|gateway)\b/i

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function scoreFixability(p: ParsedError): Fixability {
  const reasons: string[] = []
  let score = 0.4 // unknown baseline

  if (INFRA.test(p.template)) {
    return { score: 0.2, reason: 'infra/runtime symptom (timeout/connection/memory/SQL) — not a localized code fix' }
  }

  if (p.category === 'Notice' || p.category === 'Warning') {
    score = 0.6
    reasons.push('notice/warning: usually a small guard')
  } else if (p.category === 'Error') {
    score = 0.45
    reasons.push('error: localized but verify intent')
  }

  if (p.file && p.line !== undefined) {
    score += 0.3
    reasons.push('stack trace localizes the fix (file:line)')
  } else {
    reasons.push('no file:line — harder to localize')
  }

  return { score: clamp(score), reason: reasons.join('; ') }
}
