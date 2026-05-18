import type { LokiQueryRangeResponse } from '@wgr/logs-client'

export type TimeRange = '15m' | '1h' | '6h' | '24h'

const RANGE_MS: Record<TimeRange, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000
}

const STEP_FOR_RANGE: Record<TimeRange, string> = {
  '15m': '30s',
  '1h': '2m',
  '6h': '10m',
  '24h': '1h'
}

interface SeriesPoint { time: number; value: number }
interface NamedSeries { name: string; points: SeriesPoint[] }
interface TopApp { app: string; env: string; host: string; volume: number }

const data = reactive({
  appsCount: 0,
  hostsCount: 0,
  linesPerMin: 0,
  errorsPerMin: 0,
  volumePerApp: [] as NamedSeries[],
  topApps: [] as TopApp[],
  recentErrors: [] as Array<{ ts: string; line: string; labels: Record<string, string> }>,
  loading: false,
  error: null as string | null,
  lastUpdate: null as Date | null
})

let timer: ReturnType<typeof setInterval> | null = null

export function useDashboardData(range: Ref<TimeRange>) {
  async function refresh() {
    const client = useLokiClient()
    if (!client) {
      data.error = 'Configurer endpoint + token dans Réglages'
      return
    }
    data.loading = true
    data.error = null

    const end = Date.now()
    const start = end - RANGE_MS[range.value]
    const step = STEP_FOR_RANGE[range.value]

    try {
      const [appsCount, hostsCount, linesRate, errorsRate, volRange, top, errors] = await Promise.all([
        client.query(`count(count by (app) (count_over_time({app=~".+"}[${range.value}])))`),
        client.query(`count(count by (host) (count_over_time({app=~".+"}[${range.value}])))`),
        client.query('sum(rate({app=~".+"}[1m])) * 60'),
        client.query('sum(rate({app=~".+", level=~"(?i)error|fatal"}[1m])) * 60'),
        client.queryRange({
          query: 'sum by (app) (rate({app=~".+"}[1m])) * 60',
          start,
          end,
          step
        }),
        client.query(`topk(15, sum by (app, env, host) (count_over_time({app=~".+"}[${range.value}])))`),
        client.queryRange({
          query: '{app=~".+", level=~"(?i)error|fatal"}',
          start: end - 60 * 60_000,
          end,
          limit: 25,
          direction: 'backward'
        })
      ])

      data.appsCount = scalar(appsCount)
      data.hostsCount = scalar(hostsCount)
      data.linesPerMin = scalar(linesRate)
      data.errorsPerMin = scalar(errorsRate)
      data.volumePerApp = matrixToSeries(volRange)
      data.topApps = vectorToTopApps(top)
      data.recentErrors = streamsToLines(errors)
      data.lastUpdate = new Date()
    } catch (e) {
      data.error = e instanceof Error ? e.message : String(e)
    } finally {
      data.loading = false
    }
  }

  function start() {
    void refresh()
    stop()
    timer = setInterval(() => void refresh(), 30_000)
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null }
  }

  watch(range, () => void refresh())

  if (typeof window !== 'undefined') {
    onMounted(start)
    onBeforeUnmount(stop)
  }

  return { data: readonly(data), refresh }
}

function scalar(res: LokiQueryRangeResponse): number {
  const r = res.data.result[0]
  if (!r) return 0
  if (r.value) return Number(r.value[1]) || 0
  if (r.values?.[0]) return Number(r.values[0][1]) || 0
  return 0
}

function matrixToSeries(res: LokiQueryRangeResponse): NamedSeries[] {
  return res.data.result
    .map((r) => ({
      name: r.metric?.app ?? r.stream?.app ?? '?',
      points: (r.values ?? []).map(([ts, v]): SeriesPoint => ({
        time: Math.floor(Number(ts) / 1_000_000),
        value: Number(v) || 0
      }))
    }))
    .sort((a, b) => sumPoints(b.points) - sumPoints(a.points))
}

function sumPoints(points: SeriesPoint[]): number {
  return points.reduce((acc, p) => acc + p.value, 0)
}

function vectorToTopApps(res: LokiQueryRangeResponse): TopApp[] {
  return res.data.result.map((r) => ({
    app: r.metric?.app ?? '?',
    env: r.metric?.env ?? '?',
    host: r.metric?.host ?? '?',
    volume: Number(r.value?.[1] ?? 0)
  }))
}

function streamsToLines(res: LokiQueryRangeResponse) {
  const out: Array<{ ts: string; line: string; labels: Record<string, string> }> = []
  for (const r of res.data.result) {
    const labels = r.stream ?? {}
    for (const [ts, line] of r.values ?? []) out.push({ ts, line, labels })
  }
  return out.sort((a, b) => Number(b.ts) - Number(a.ts)).slice(0, 25)
}
