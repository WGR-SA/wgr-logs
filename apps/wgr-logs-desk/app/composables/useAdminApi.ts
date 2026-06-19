/**
 * Typed client for the wgr-logs management API (NestJS).
 * Talks to the admin endpoints under https://logs.example.com/mgmt.
 *
 * Auth: Bearer WGR_API_ADMIN_TOKEN (stored in settings).
 */

export type SourceType =
  | 'pm2' | 'cakephp' | 'wordpress' | 'prestashop'
  | 'nginx' | 'journald' | 'docker' | 'files'

export type AgentStatus = 'pending' | 'active' | 'disabled'
export type ShipperKind = 'docker' | 'bash' | 'php' | 'cf-tail' | 'browser' | 'unknown'

export interface Source {
  id: number
  type: SourceType
  config: Record<string, unknown>
  enabled: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  hostname: string | null
  env: string
  cluster: string
  shipperKind: ShipperKind | null
  shipperVer: string | null
  status: AgentStatus
  lastSeen: string | null
  createdAt: string
  updatedAt: string
  sources?: Source[]
}

export interface SourceTypesCatalog {
  definitions: Record<string, {
    title: string
    description: string
    icon: string
    type: string
    required: string[]
    properties: Record<string, {
      title?: string
      description?: string
      type?: string
      const?: string
      default?: unknown
      items?: { type: string }
      additionalProperties?: unknown
    }>
  }>
}

export type ProblemStatus = 'open' | 'fixing' | 'pr' | 'merged' | 'wontfix'

export interface Problem {
  id: number
  project: string
  signature: string
  category: string
  tech: string | null
  patternHash: string | null
  file: string | null
  line: number | null
  sample: string
  count: number
  fixabilityScore: number
  status: ProblemStatus
  firstSeen: string
  lastSeen: string
}

export type RemediationStatus =
  | 'open' | 'fixing' | 'pr_open' | 'needs_input'
  | 'changes_requested' | 'merged' | 'wontfix' | 'failed'

export interface Remediation {
  id: number
  problemId: number
  problem?: Problem
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
  pendingComment: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectOverview {
  name: string
  problemsTotal: number
  problemsOpen: number
  remediationsTotal: number
  prOpen: number
  changesRequested: number
  merged: number
  failed: number
}

export class AdminApiError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message)
    this.name = 'AdminApiError'
  }
}

class AdminApi {
  private readonly fetchImpl = globalThis.fetch.bind(globalThis)

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async listAgents(): Promise<Agent[]> {
    return this.req<Agent[]>('GET', '/agents')
  }

  async getAgent(id: string): Promise<Agent> {
    return this.req<Agent>('GET', `/agents/${id}`)
  }

  async updateAgent(id: string, dto: Partial<Pick<Agent, 'name' | 'env' | 'cluster' | 'status'>>): Promise<Agent> {
    return this.req<Agent>('PUT', `/agents/${id}`, dto)
  }

  async deleteAgent(id: string): Promise<void> {
    await this.req<void>('DELETE', `/agents/${id}`)
  }

  async listSources(agentId: string): Promise<Source[]> {
    return this.req<Source[]>('GET', `/agents/${agentId}/sources`)
  }

  async createSource(agentId: string, dto: {
    type: SourceType
    config: Record<string, unknown>
    enabled?: boolean
    position?: number
  }): Promise<Source> {
    return this.req<Source>('POST', `/agents/${agentId}/sources`, dto)
  }

  async updateSource(agentId: string, sourceId: number, dto: {
    config?: Record<string, unknown>
    enabled?: boolean
    position?: number
  }): Promise<Source> {
    return this.req<Source>('PUT', `/agents/${agentId}/sources/${sourceId}`, dto)
  }

  async deleteSource(agentId: string, sourceId: number): Promise<void> {
    await this.req<void>('DELETE', `/agents/${agentId}/sources/${sourceId}`)
  }

  async sourceTypes(): Promise<SourceTypesCatalog> {
    return this.req<SourceTypesCatalog>('GET', '/source-types')
  }

  async health(): Promise<{ status: string; database: string }> {
    return this.req<{ status: string; database: string }>('GET', '/health')
  }

  async listProjects(): Promise<ProjectOverview[]> {
    return this.req<ProjectOverview[]>('GET', '/projects')
  }

  async listProblems(project: string): Promise<Problem[]> {
    return this.req<Problem[]>('GET', `/projects/${encodeURIComponent(project)}/problems`)
  }

  async listRemediations(project: string): Promise<Remediation[]> {
    return this.req<Remediation[]>('GET', `/projects/${encodeURIComponent(project)}/remediations`)
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (res.status === 204) return undefined as T
    if (!res.ok) {
      throw new AdminApiError(
        `${method} ${path} → ${res.status}`,
        res.status,
        await res.text()
      )
    }
    return res.json() as Promise<T>
  }
}

let cached: { client: AdminApi; key: string } | null = null

export function useAdminApi(): AdminApi | null {
  const settings = useSettingsStore()
  const baseUrl = settings.adminApiUrl.value.replace(/\/$/, '')
  const token = settings.adminToken.value
  if (!baseUrl || !token) return null

  const key = `${baseUrl}::${token}`
  if (cached?.key === key) return cached.client

  const client = new AdminApi(baseUrl, token)
  cached = { client, key }
  return client
}
