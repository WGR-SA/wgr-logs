import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Per-target persisted state under ~/.wgr-logs-agent/state/<target>/. */

export interface AgentState {
  agentId: string
  /** sha256 of the agent token — never the token itself. */
  tokenSha256: string
  name: string
  registeredAt: string
}

function baseDir(): string {
  return join(homedir(), '.wgr-logs-agent', 'state')
}

function targetDir(name: string): string {
  return join(baseDir(), name.replace(/[^a-zA-Z0-9._-]/g, '_'))
}

function readJson<T>(name: string, file: string): T | null {
  const path = join(targetDir(name), file)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(name: string, file: string, data: unknown): void {
  const dir = targetDir(name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
}

export function readAgentState(name: string): AgentState | null {
  return readJson<AgentState>(name, 'agent.json')
}

export function writeAgentState(name: string, state: AgentState): void {
  writeJson(name, 'agent.json', state)
}

export function readLastRun(name: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(name, 'last-run.json')
}

export function writeLastRun(name: string, data: Record<string, unknown>): void {
  writeJson(name, 'last-run.json', data)
}
