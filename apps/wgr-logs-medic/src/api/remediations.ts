import type { ApiConfig } from '../config/env.js'
import type { Remediation } from '../types.js'

function authHeaders(cfg: ApiConfig): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.adminToken}` }
}

export interface CreateRemediationBody {
  problemId: number
  repo: string
  branch?: string
  prUrl?: string
  prNumber?: number
  sessionId?: string
  status?: string
  costUsd?: number
  summary?: string
  diffStat?: string
  notVerified?: string
}

export async function createRemediation(
  cfg: ApiConfig,
  project: string,
  body: CreateRemediationBody,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation> {
  const res = await fetchImpl(`${cfg.url}/projects/${encodeURIComponent(project)}/remediations`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`create remediation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation
}

export async function updateRemediation(
  cfg: ApiConfig,
  id: number,
  patch: Partial<CreateRemediationBody>,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation> {
  const res = await fetchImpl(`${cfg.url}/remediations/${id}`, {
    method: 'PATCH',
    headers: authHeaders(cfg),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update remediation failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation
}

export async function listRemediations(
  cfg: ApiConfig,
  project: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Remediation[]> {
  const res = await fetchImpl(`${cfg.url}/projects/${encodeURIComponent(project)}/remediations`, {
    headers: authHeaders(cfg),
  })
  if (!res.ok) throw new Error(`list remediations failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as Remediation[]
}
