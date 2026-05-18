<script setup lang="ts">
import type { TimeRange } from '~/composables/useDashboardData'

const settings = useSettingsStore()
const range = ref<TimeRange>('1h')
const { data, refresh } = useDashboardData(range)

const router = useRouter()

const rangeItems = [
  { label: '15 min', value: '15m' },
  { label: '1 h',    value: '1h' },
  { label: '6 h',    value: '6h' },
  { label: '24 h',   value: '24h' }
]

function openSearch(app: string) {
  router.push({ path: '/search', query: { q: `{app="${app}"}` } })
}

function openLive(app: string) {
  router.push({ path: '/live', query: { q: `{app="${app}"}` } })
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <h2 class="text-sm font-semibold">Dashboard</h2>
      <USelect v-model="range" :items="rangeItems" size="xs" />
      <span v-if="data.lastUpdate" class="text-xs text-neutral-500">
        Mis à jour {{ data.lastUpdate.toLocaleTimeString('fr-CH') }}
      </span>
      <span v-if="data.error" class="text-red-400 text-xs">{{ data.error }}</span>
      <UButton
        class="ml-auto"
        size="xs"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="data.loading"
        @click="refresh()"
      >
        Rafraîchir
      </UButton>
    </header>

    <div v-if="!settings.endpoint.value" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      <div class="text-center">
        <UIcon name="i-lucide-settings-2" class="size-8 mx-auto mb-2" />
        <p>Configure l'endpoint et le token dans Réglages d'abord.</p>
        <UButton class="mt-3" to="/settings" size="sm">Ouvrir Réglages</UButton>
      </div>
    </div>

    <div v-else class="p-4 flex flex-col gap-4">
      <div class="grid grid-cols-4 gap-3">
        <StatCard
          label="Apps actives"
          icon="i-lucide-boxes"
          tone="default"
          :value="data.appsCount"
          :loading="data.loading && data.appsCount === 0"
        />
        <StatCard
          label="Lignes / min"
          icon="i-lucide-activity"
          tone="success"
          :value="data.linesPerMin"
          unit="lpm"
          :loading="data.loading && data.linesPerMin === 0"
        />
        <StatCard
          label="Erreurs / min"
          icon="i-lucide-triangle-alert"
          :tone="data.errorsPerMin > 1 ? 'error' : data.errorsPerMin > 0 ? 'warn' : 'success'"
          :value="data.errorsPerMin"
          unit="epm"
          :loading="data.loading && data.errorsPerMin === 0"
        />
        <StatCard
          label="Hosts"
          icon="i-lucide-server"
          tone="default"
          :value="data.hostsCount"
          :loading="data.loading && data.hostsCount === 0"
        />
      </div>

      <StackedAreaChart :series="data.volumePerApp" :height="240" />

      <div class="grid grid-cols-2 gap-4">
        <div class="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div class="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
            <h3 class="text-sm font-medium text-neutral-300">Top apps (fenêtre {{ range }})</h3>
            <span class="text-xs text-neutral-500">{{ data.topApps.length }}</span>
          </div>
          <div v-if="data.topApps.length === 0" class="p-6 text-center text-neutral-500 text-xs">
            Aucune donnée
          </div>
          <ul v-else class="divide-y divide-neutral-800/60">
            <li
              v-for="row in data.topApps"
              :key="row.app + row.env + row.host"
              class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-900/80 group"
            >
              <span class="font-mono text-sm text-neutral-200 truncate flex-1">{{ row.app }}</span>
              <span class="text-xs text-neutral-500">{{ row.env }}</span>
              <span class="text-xs text-neutral-500 truncate max-w-[120px]">{{ row.host }}</span>
              <span class="text-xs font-mono text-sky-300 tabular-nums w-16 text-right">
                {{ row.volume.toFixed(0) }}
              </span>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <UButton size="xs" variant="ghost" icon="i-lucide-radio" :title="`Live tail ${row.app}`" @click="openLive(row.app)" />
                <UButton size="xs" variant="ghost" icon="i-lucide-search" :title="`Recherche ${row.app}`" @click="openSearch(row.app)" />
              </div>
            </li>
          </ul>
        </div>

        <div class="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div class="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
            <h3 class="text-sm font-medium text-neutral-300">Erreurs récentes (1h)</h3>
            <UBadge :color="data.recentErrors.length > 0 ? 'error' : 'success'" variant="soft" size="xs">
              {{ data.recentErrors.length }}
            </UBadge>
          </div>
          <div v-if="data.recentErrors.length === 0" class="p-6 text-center text-neutral-500 text-xs">
            Aucune erreur. ✨
          </div>
          <div v-else class="max-h-[420px] overflow-y-auto">
            <LogLine
              v-for="entry in data.recentErrors"
              :key="entry.ts + entry.line"
              :ts="entry.ts"
              :line="entry.line"
              :labels="entry.labels"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
