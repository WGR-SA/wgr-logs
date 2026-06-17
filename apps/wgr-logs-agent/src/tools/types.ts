import { z } from 'zod'

/**
 * Zod mirrors of the wgr-logs-api DTOs/entities. We duplicate (rather than import
 * the CommonJS NestJS app into this ESM workspace) — the API stays the source of
 * truth (`apps/wgr-logs-api/src/agents/*`, `src/sources/*`); keep these in sync.
 */

export const SHIPPER_KINDS = ['docker', 'bash', 'php', 'cf-tail', 'browser', 'unknown'] as const
export const ShipperKindSchema = z.enum(SHIPPER_KINDS)
export type ShipperKind = z.infer<typeof ShipperKindSchema>

export const SOURCE_TYPES = ['pm2', 'cakephp', 'wordpress', 'prestashop', 'nginx', 'journald', 'docker', 'files'] as const
export const SourceTypeSchema = z.enum(SOURCE_TYPES)
export type SourceType = z.infer<typeof SourceTypeSchema>

export const AgentStatusSchema = z.enum(['pending', 'active', 'disabled'])
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const SourceSchema = z.object({
  id: z.number(),
  type: SourceTypeSchema,
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  position: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type Source = z.infer<typeof SourceSchema>

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string().nullable().optional(),
  env: z.string(),
  cluster: z.string(),
  shipperKind: ShipperKindSchema.nullable().optional(),
  shipperVer: z.string().nullable().optional(),
  status: AgentStatusSchema,
  lastSeen: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
})
export type Agent = z.infer<typeof AgentSchema>

export const RegisterAgentResponseSchema = z.object({
  agent_id: z.string(),
  agent_token: z.string(),
  status: AgentStatusSchema,
})
export type RegisterAgentResponse = z.infer<typeof RegisterAgentResponseSchema>

export interface RegisterAgentRequest {
  name: string
  hostname?: string
  shipper_kind?: ShipperKind
  shipper_ver?: string
  env?: string
  register_token: string
}

export interface CreateSourceRequest {
  type: SourceType
  config: Record<string, unknown>
  enabled?: boolean
  position?: number
}
