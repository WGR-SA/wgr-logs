import type { Project } from '../config/projects.js'
import type { ProblemCandidate } from '../types.js'
import { parseError } from './signature.js'
import { scoreFixability } from './fixability.js'
import { redact } from './redact.js'

/** Returns the first line of each error event in the window for a selector. */
export type LokiReader = (selector: string, startMs: number, endMs: number) => Promise<string[]>

export function groupCandidates(lines: readonly string[], tech?: string): ProblemCandidate[] {
  const bySig = new Map<string, ProblemCandidate>()
  for (const raw of lines) {
    const firstLine = raw.split('\n', 1)[0]
    const p = parseError(firstLine)
    const existing = bySig.get(p.signature)
    if (existing) {
      existing.count += 1
      continue
    }
    bySig.set(p.signature, {
      signature: p.signature,
      patternHash: p.patternHash,
      tech,
      category: p.category,
      file: p.file,
      line: p.line,
      sample: redact(firstLine),
      count: 1,
      fixabilityScore: scoreFixability(p).score,
    })
  }
  return [...bySig.values()].sort((a, b) => b.fixabilityScore - a.fixabilityScore || b.count - a.count)
}

export interface ScanOptions {
  projects: readonly Project[]
  reader: LokiReader
  windowMs: number
  now: number
}

export interface ProjectScan {
  project: string
  candidates: ProblemCandidate[]
}

export async function runScan(opts: ScanOptions): Promise<ProjectScan[]> {
  const out: ProjectScan[] = []
  for (const project of opts.projects) {
    const lines = await opts.reader(project.lokiSelector, opts.now - opts.windowMs, opts.now)
    out.push({ project: project.name, candidates: groupCandidates(lines, project.tech) })
  }
  return out
}
