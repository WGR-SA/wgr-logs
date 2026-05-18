import { LokiClient } from '@wgr/logs-client'

let cached: { client: LokiClient; key: string } | null = null

export function useLokiClient(): LokiClient | null {
  const settings = useSettingsStore()
  const endpoint = settings.endpoint.value
  const token = settings.token.value
  if (!endpoint || !token) return null

  const key = `${endpoint}::${token}`
  if (cached?.key === key) return cached.client

  const client = new LokiClient({
    baseUrl: endpoint,
    basicAuth: { username: 'wgr', password: token }
  })
  cached = { client, key }
  return client
}
