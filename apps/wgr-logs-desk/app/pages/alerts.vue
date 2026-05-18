<script setup lang="ts">
const alerts = useAlertWatcher()
const settings = useSettingsStore()

function openInGrafana() {
  const base = settings.grafanaUrl.value
  if (!base) return
  window.open(`${base}/alerting/list`, '_blank')
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
      <h2 class="text-sm font-semibold">Alertes actives</h2>
      <UBadge :color="alerts.firing.value.length > 0 ? 'error' : 'success'" variant="soft" size="sm">
        {{ alerts.firing.value.length }} firing
      </UBadge>
      <span v-if="alerts.lastError.value" class="text-red-400 text-xs ml-2">
        {{ alerts.lastError.value }}
      </span>
      <UButton class="ml-auto" size="xs" variant="outline" icon="i-lucide-refresh-cw" @click="alerts.refresh()">
        Rafraîchir
      </UButton>
      <UButton size="xs" variant="ghost" icon="i-lucide-external-link" @click="openInGrafana">
        Grafana
      </UButton>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div v-if="alerts.firing.value.length === 0" class="p-8 text-center text-neutral-500 text-sm">
        <UIcon name="i-lucide-shield-check" class="size-8 mx-auto mb-2 text-emerald-400" />
        Tout est calme.
      </div>

      <ul v-else class="divide-y divide-neutral-800">
        <li
          v-for="alert in alerts.firing.value"
          :key="alert.fingerprint"
          class="px-4 py-3 hover:bg-neutral-900/50"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-flame" class="text-red-400" />
            <span class="font-medium">{{ alert.labels.alertname ?? 'Alerte' }}</span>
            <UBadge :color="alert.labels.severity === 'critical' ? 'error' : 'warning'" size="xs">
              {{ alert.labels.severity ?? 'info' }}
            </UBadge>
            <span v-if="alert.activeAt" class="text-xs text-neutral-500 ml-auto">
              depuis {{ new Date(alert.activeAt).toLocaleString('fr-CH') }}
            </span>
          </div>
          <p class="text-sm text-neutral-300 mt-1">{{ alert.annotations.summary ?? '—' }}</p>
          <div class="flex flex-wrap gap-1 mt-2">
            <span
              v-for="(value, name) in alert.labels"
              :key="name"
              class="text-xs px-1.5 py-0.5 rounded bg-neutral-800 font-mono text-neutral-300"
            >
              {{ name }}={{ value }}
            </span>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
