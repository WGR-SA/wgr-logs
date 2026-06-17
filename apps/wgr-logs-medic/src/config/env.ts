import { z } from 'zod'

const EnvSchema = z.object({
  WGR_API_URL: z.string().optional(),
  WGR_API_ADMIN_TOKEN: z.string().optional(),
  WGR_INGEST_URL: z.string().optional(),
  WGR_INGEST_TOKEN: z.string().optional(),
  LOGS_DOMAIN: z.string().optional(),
  INGEST_DOMAIN: z.string().optional(),
  INGEST_AUTH_TOKEN: z.string().optional(),
})
export type Env = z.infer<typeof EnvSchema>

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source)
}

function https(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`
}

export interface ApiConfig {
  url: string
  adminToken: string
}
export function requireApi(env: Env): ApiConfig {
  const url = env.WGR_API_URL ?? (env.LOGS_DOMAIN ? `${https(env.LOGS_DOMAIN)}/mgmt` : undefined)
  if (!url) throw new ConfigError('Set WGR_API_URL or LOGS_DOMAIN')
  if (!env.WGR_API_ADMIN_TOKEN) throw new ConfigError('Set WGR_API_ADMIN_TOKEN')
  return { url: url.replace(/\/$/, ''), adminToken: env.WGR_API_ADMIN_TOKEN }
}

export interface LokiConfig {
  baseUrl: string
  token: string
}
export function requireLoki(env: Env): LokiConfig {
  const baseUrl = env.WGR_INGEST_URL ?? (env.INGEST_DOMAIN ? https(env.INGEST_DOMAIN) : undefined)
  const token = env.WGR_INGEST_TOKEN ?? env.INGEST_AUTH_TOKEN
  if (!baseUrl) throw new ConfigError('Set WGR_INGEST_URL or INGEST_DOMAIN')
  if (!token) throw new ConfigError('Set WGR_INGEST_TOKEN or INGEST_AUTH_TOKEN')
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}
