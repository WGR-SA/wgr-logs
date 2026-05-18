import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification'
import type { AlertInstance } from '@wgr/logs-client'

const POLL_INTERVAL_MS = 15_000

const firing = ref<AlertInstance[]>([])
const lastError = ref<string | null>(null)
const seen = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null
let permissionAsked = false

/**
 * Polls Grafana Alertmanager every 15s. On a NEW firing alert (not previously
 * seen this session), fires a native OS notification. Pattern lifted from
 * wgr-clip's useBatchNotification.
 */
export function useAlertWatcher() {
  const settings = useSettingsStore()

  function start() {
    if (timer) return
    void tick()
    timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  async function tick() {
    const client = useLokiClient()
    const grafana = settings.grafanaUrl.value
    if (!client || !grafana) return
    try {
      const alerts = await client.activeAlerts(grafana)
      const newFiring = alerts.filter((a) => a.state === 'firing')
      firing.value = newFiring
      lastError.value = null

      if (settings.notifyOnFiring.value) {
        for (const alert of newFiring) {
          if (seen.has(alert.fingerprint)) continue
          seen.add(alert.fingerprint)
          await notify(alert)
        }
      }
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function notify(alert: AlertInstance) {
    try {
      let granted = await isPermissionGranted()
      if (!granted && !permissionAsked) {
        permissionAsked = true
        granted = (await requestPermission()) === 'granted'
      }
      if (!granted) return
      sendNotification({
        title: `🔥 ${alert.labels.alertname ?? 'Alerte'}`,
        body: alert.annotations.summary ?? `${alert.labels.app ?? '?'} — ${alert.labels.severity ?? '?'}`
      })
    } catch (e) {
      console.warn('[alert-watcher] notify failed', e)
    }
  }

  if (typeof window !== 'undefined') {
    onMounted(start)
    onBeforeUnmount(stop)
  }

  return {
    firing: readonly(firing),
    lastError: readonly(lastError),
    refresh: tick,
    start,
    stop
  }
}
