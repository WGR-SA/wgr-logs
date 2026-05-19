import type { LokiQueryRangeResponse } from '@wgr/logs-client'

export type AppTimeRange = '15m' | '1h' | '6h' | '24h' | '7d'

const RANGE_MS: Record<AppTimeRange, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
}
const STEP_FOR_RANGE: Record<AppTimeRange, string> = {
  '15m': '30s',
  '1h': '2m',
  '6h': '10m',
  '24h': '1h',
  '7d': '6h',
}

interface SeriesPoint { time: number; value: number }
interface NamedSeries { name: string; points: SeriesPoint[] }
interface LogEntry { ts: string; line: string; labels: Record<string, string> }

interface AppMetrics {
  linesPerMin: number
  errorsPerMin: number
  hostsCount: number
  sourcesCount: number
  volumeByLevel: NamedSeries[]
  topHosts: Array<{ host: string; volume: number }>
  topSources: Array<{ source: string; volume: number }>
  recentErrors: LogEntry[]
}

function emptyMetrics(): AppMetrics {
  return {
    linesPerMin: 0,
    errorsPerMin: 0,
    hostsCount: 0,
    sourcesCount: 0,
    volumeByLevel: [],
    topHosts: [],
    topSources: [],
    recentErrors: [],
  }
}

export function useAppMetrics(app: Ref<string>, range: Ref<AppTimeRange>) {
  const data = reactive<AppMetrics & { loading: boolean; error: string | null; lastUpdate: Date | null }>({
    ...emptyMetrics(),
    loading: false,
    error: null,
    lastUpdate: null,
  })

  async function refresh() {
    const client = useLokiClient()
    if (!client) {
      data.error = 'Configure endpoint + token in Settings'
      return
    }
    if (!app.value) return
    data.loading = true
    data.error = null

    const end = Date.now()
    const start = end - RANGE_MS[range.value]
    const step = STEP_FOR_RANGE[range.value]
    const appSel = `app="${escapeQuotes(app.value)}"`

    try {
      const [linesRate, errorsRate, hostsCount, sourcesCount, volByLevel, topHosts, topSources, recentErrors] = await Promise.all([
        client.query(`sum(rate({${appSel}}[1m])) * 60`),
        client.query(`sum(rate({${appSel}, level=~"(?i)error|fatal"}[1m])) * 60`),
        client.query(`count(count by (host) (count_over_time({${appSel}}[${range.value}])))`),
        client.query(`count(count by (source) (count_over_time({${appSel}}[${range.value}])))`),
        client.queryRange({
          query: `sum by (level) (rate({${appSel}}[1m])) * 60`,
          start, end, step,
        }),
        client.query(`topk(10, sum by (host) (count_over_time({${appSel}}[${range.value}])))`),
        client.query(`topk(10, sum by (source) (count_over_time({${appSel}}[${range.value}])))`),
        client.queryRange({
          query: `{${appSel}, level=~"(?i)error|fatal"}`,
          start: end - Math.min(RANGE_MS[range.value], 6 * 60 * 60_000),
          end,
          limit: 50,
          direction: 'backward',
        }),
      ])

      Object.assign(data, emptyMetrics(), {
        linesPerMin: scalar(linesRate),
        errorsPerMin: scalar(errorsRate),
        hostsCount: scalar(hostsCount),
        sourcesCount: scalar(sourcesCount),
        volumeByLevel: matrixToSeries(volByLevel, 'level'),
        topHosts: vectorToTopBy(topHosts, 'host'),
        topSources: vectorToTopBy(topSources, 'source'),
        recentErrors: streamsToLines(recentErrors),
      })
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
      timer = setInterval(() => void refresh(), 30_000)
    })
    onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  }

  watch([app, range], () => void refresh())

  return { data: readonly(data), refresh }
}

function escapeQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function scalar(res: LokiQueryRangeResponse): number {
  const r = res.data.result[0]
  if (!r) return 0
  if (r.value) return Number(r.value[1]) || 0
  if (r.values?.[0]) return Number(r.values[0][1]) || 0
  return 0
}

function matrixToSeries(res: LokiQueryRangeResponse, groupBy: string): NamedSeries[] {
  return res.data.result
    .map((r) => ({
      name: r.metric?.[groupBy] ?? '?',
      points: (r.values ?? []).map(([ts, v]): SeriesPoint => ({
        time: Math.floor(Number(ts) / 1_000_000),
        value: Number(v) || 0,
      })),
    }))
    .sort((a, b) => sumPoints(b.points) - sumPoints(a.points))
}

function sumPoints(points: SeriesPoint[]): number {
  return points.reduce((acc, p) => acc + p.value, 0)
}

function vectorToTopBy<K extends string>(res: LokiQueryRangeResponse, key: K) {
  return res.data.result.map((r) => ({
    [key]: r.metric?.[key] ?? '?',
    volume: Number(r.value?.[1] ?? 0),
  })) as Array<{ [k in K]: string } & { volume: number }>
}

function streamsToLines(res: LokiQueryRangeResponse): LogEntry[] {
  const out: LogEntry[] = []
  for (const r of res.data.result) {
    const labels = r.stream ?? {}
    for (const [ts, line] of r.values ?? []) out.push({ ts, line, labels })
  }
  return out.sort((a, b) => Number(b.ts) - Number(a.ts)).slice(0, 50)
}
