import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { Agent } from '../agents/agent.entity'
import { Source } from '../sources/source.entity'

export interface RenderedConfig {
  agent_id: string
  env: string
  cluster: string
  host: string | null
  sources: Array<{
    type: string
    config: Record<string, unknown>
    enabled: boolean
    position: number
  }>
}

@Injectable()
export class RendererService {
  /**
   * Serialise an agent + its sources into the JSON contract the shipper
   * polls. Deterministic ordering so the ETag is stable.
   */
  render(agent: Agent, sources: Source[]): { rendered: RenderedConfig; etag: string } {
    const ordered = [...sources]
      .filter((s) => s.enabled)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((s) => ({
        type: s.type,
        config: s.config,
        enabled: s.enabled,
        position: s.position,
      }))

    const rendered: RenderedConfig = {
      agent_id: agent.id,
      env: agent.env,
      cluster: agent.cluster,
      host: agent.hostname,
      sources: ordered,
    }

    const etag = createHash('sha256')
      .update(JSON.stringify(rendered))
      .digest('hex')
      .slice(0, 16)

    return { rendered, etag }
  }
}
