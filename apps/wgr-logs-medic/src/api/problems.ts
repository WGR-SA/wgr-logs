import type { LokiClient } from '@wgr/logs-client'
import type { ApiConfig } from '../config/env.js'
import type { LokiReader } from '../scan/scanner.js'
import type { ProblemCandidate } from '../types.js'

export async function postProblem(
  config: ApiConfig,
  project: string,
  candidate: ProblemCandidate,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${config.url}/projects/${encodeURIComponent(project)}/problems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.adminToken}` },
    body: JSON.stringify(candidate),
  })
  if (!res.ok) throw new Error(`POST problem failed: ${res.status} ${await res.text()}`)
}

/** Build a LokiReader backed by @wgr/logs-client: returns the first line of each error event. */
export function lokiReader(client: LokiClient): LokiReader {
  return async (selector, startMs, endMs) => {
    const res = await client.queryRange({ query: selector, start: startMs, end: endMs, direction: 'backward', limit: 1000 })
    const lines: string[] = []
    for (const stream of res.data.result) {
      for (const [, line] of stream.values ?? []) lines.push(line)
    }
    return lines
  }
}
