import { z } from 'zod'
import { ConfigError } from '../lib/errors.js'

/**
 * Process env, validated at the boundary. URLs are kept as plain strings
 * (no `.url()` — avoids zod-version drift); fetch surfaces malformed URLs clearly.
 * All fields optional here; per-operation requirements are enforced by the
 * `require*` helpers so each intent only demands what it needs.
 */
const EnvSchema = z.object({
  WGR_API_URL: z.string().min(1).optional(),
  WGR_API_ADMIN_TOKEN: z.string().min(1).optional(),
  WGR_API_REGISTER_TOKEN: z.string().min(1).optional(),
  WGR_INGEST_URL: z.string().min(1).optional(),
  WGR_INGEST_TOKEN: z.string().min(1).optional(),
  // Native stack .env names (docker-compose), accepted as fallbacks so the agent
  // runs against the existing .env without remapping.
  LOGS_DOMAIN: z.string().min(1).optional(),
  INGEST_DOMAIN: z.string().min(1).optional(),
  INGEST_AUTH_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  WGR_AGENT_MODEL: z.string().min(1).optional(),
  WGR_AGENT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
})

function httpsFromDomain(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`
}

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment: ${parsed.error.issues.map((i) => i.message).join(', ')}`)
  }
  return parsed.data
}

export interface AdminApiConfig {
  url: string
  adminToken: string
  registerToken?: string
}

export function requireAdminApi(env: Env): AdminApiConfig {
  const url = env.WGR_API_URL ?? (env.LOGS_DOMAIN ? httpsFromDomain(env.LOGS_DOMAIN) : undefined)
  if (!url) throw new ConfigError('WGR_API_URL (or LOGS_DOMAIN) is required for admin API calls.')
  if (!env.WGR_API_ADMIN_TOKEN) throw new ConfigError('WGR_API_ADMIN_TOKEN is required for admin API calls.')
  return {
    url: url.replace(/\/$/, ''),
    adminToken: env.WGR_API_ADMIN_TOKEN,
    registerToken: env.WGR_API_REGISTER_TOKEN,
  }
}

export interface IngestConfig {
  url: string
  token: string
}

export function requireIngest(env: Env): IngestConfig {
  const url = env.WGR_INGEST_URL ?? (env.INGEST_DOMAIN ? httpsFromDomain(env.INGEST_DOMAIN) : undefined)
  const token = env.WGR_INGEST_TOKEN ?? env.INGEST_AUTH_TOKEN
  if (!url) throw new ConfigError('WGR_INGEST_URL (or INGEST_DOMAIN) is required for Loki queries.')
  if (!token) throw new ConfigError('WGR_INGEST_TOKEN (or INGEST_AUTH_TOKEN) is required for Loki queries.')
  return { url: url.replace(/\/$/, ''), token }
}
