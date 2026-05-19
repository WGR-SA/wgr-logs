import type { LokiQueryRangeResponse } from '@wgr/logs-client'

interface AppRow {
  app: string
  framework: string
  host: string
  source: string
  volume: number
  errors: number
}

const data = reactive({
  apps: [] as AppRow[],
  loading: false,
  error: null as string | null,
  lastUpdate: null as Date | null
})

const RANGE_MS = 60 * 60_000  // 1h

export function useAppsList() {
  async function refresh() {
    const client = useLokiClient()
    if (!client) {
      data.error = 'Configure Loki endpoint + token in Settings'
      return
    }
    data.loading = true
    data.error = null

    const end = Date.now()
    const start = end - RANGE_MS

    try {
      const [vol, errs] = await Promise.all([
        client.query(`topk(200, sum by (app, framework, host, source) (count_over_time({app=~".+"}[1h])))`),
        client.query(`topk(200, sum by (app) (count_over_time({app=~".+", level=~"(?i)error|fatal"}[1h])))`),
      ])

      const errorMap = new Map<string, number>()
      for (const r of errs.data.result ?? []) {
        const a = r.metric?.app
        if (a) errorMap.set(a, Number(r.value?.[1] ?? 0))
      }

      const rows: AppRow[] = []
      for (const r of vol.data.result ?? []) {
        const app = r.metric?.app ?? '?'
        rows.push({
          app,
          framework: r.metric?.framework ?? '',
          host: r.metric?.host ?? '',
          source: r.metric?.source ?? '',
          volume: Number(r.value?.[1] ?? 0),
          errors: errorMap.get(app) ?? 0,
        })
      }
      rows.sort((a, b) => b.errors - a.errors || b.volume - a.volume)
      data.apps = rows
      data.lastUpdate = new Date()
    } catch (e) {
      data.error = e instanceof Error ? e.message : String(e)
    } finally {
      data.loading = false
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  if (typeof window !== 'undefined') {
    onMounted(() => {
      void refresh()
      timer = setInterval(() => void refresh(), 60_000)
    })
    onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  }

  return { data: readonly(data), refresh }
}
