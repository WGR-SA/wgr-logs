import type { ProjectContext } from '../types.js'

export interface EnsureContextDeps {
  repo: string
  tech?: string
  dir: string
  getCtx: (repo: string) => Promise<ProjectContext | null>
  putCtx: (repo: string, body: { tech?: string; summary: string }) => Promise<ProjectContext>
  generate: (dir: string) => Promise<string>
  readClaudeMd: (dir: string) => string | null
  writeClaudeMd: (summary: string) => void
}

/** Return per-project codebase understanding, generating + caching it once if absent. */
export async function ensureProjectContext(deps: EnsureContextDeps): Promise<string> {
  const cached = await deps.getCtx(deps.repo)
  if (cached?.summary) return cached.summary

  const existing = deps.readClaudeMd(deps.dir)
  if (existing) return existing

  const summary = await deps.generate(deps.dir)
  deps.writeClaudeMd(summary)
  await deps.putCtx(deps.repo, { tech: deps.tech, summary })
  return summary
}
