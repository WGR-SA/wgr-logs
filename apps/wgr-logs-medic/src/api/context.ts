import type { ApiConfig } from '../config/env.js'
import type { ProjectContext } from '../types.js'

function authHeaders(cfg: ApiConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.adminToken}` }
}

export async function getProjectContext(
  cfg: ApiConfig,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectContext | null> {
  const res = await fetchImpl(`${cfg.url}/project-context/${encodeURIComponent(repo)}`, {
    headers: authHeaders(cfg),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get project-context failed: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? (JSON.parse(text) as ProjectContext) : null
}

export async function putProjectContext(
  cfg: ApiConfig,
  repo: string,
  body: { tech?: string; summary: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectContext> {
  const res = await fetchImpl(`${cfg.url}/project-context/${encodeURIComponent(repo)}`, {
    method: 'PUT',
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`put project-context failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as ProjectContext
}
