<script setup lang="ts">
import type { AppTimeRange } from '~/composables/useAppMetrics'

const route = useRoute()
const router = useRouter()
const app = computed(() => decodeURIComponent(route.params.app as string))
const range = ref<AppTimeRange>('1h')

const { data, refresh } = useAppMetrics(app, range)

const rangeItems = [
  { label: '15 min', value: '15m' },
  { label: '1 h',    value: '1h' },
  { label: '6 h',    value: '6h' },
  { label: '24 h',   value: '24h' },
  { label: '7 j',    value: '7d' },
]

function openLive() {
  router.push({ path: '/live', query: { q: `{app="${app.value}"}` } })
}
function openSearch() {
  router.push({ path: '/search', query: { q: `{app="${app.value}"}` } })
}
function openSearchErrors() {
  router.push({ path: '/search', query: { q: `{app="${app.value}", level=~"(?i)error|fatal"}` } })
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <UButton size="xs" variant="ghost" icon="i-lucide-arrow-left" to="/apps" />
      <h2 class="text-sm font-semibold font-mono">{{ app }}</h2>
      <USelect v-model="range" :items="rangeItems" size="xs" class="ml-2" />
      <span v-if="data.lastUpdate" class="text-xs text-neutral-500">
        Updated {{ data.lastUpdate.toLocaleTimeString('fr-CH') }}
      </span>
      <span v-if="data.error" class="text-red-400 text-xs">{{ data.error }}</span>

      <div class="ml-auto flex items-center gap-1">
        <UButton size="xs" variant="ghost" icon="i-lucide-radio" @click="openLive">Live</UButton>
        <UButton size="xs" variant="ghost" icon="i-lucide-search" @click="openSearch">Search</UButton>
        <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="data.loading" @click="refresh()" />
      </div>
    </header>

    <div class="p-4 flex flex-col gap-4">
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-3">
        <StatCard
          label="Lines / min"
          icon="i-lucide-activity"
          tone="success"
          :value="data.linesPerMin"
          unit="lpm"
          :loading="data.loading && data.linesPerMin === 0"
        />
        <StatCard
          label="Errors / min"
          icon="i-lucide-triangle-alert"
          :tone="data.errorsPerMin > 1 ? 'error' : data.errorsPerMin > 0 ? 'warn' : 'success'"
          :value="data.errorsPerMin"
          unit="epm"
        />
        <StatCard
          label="Hosts"
          icon="i-lucide-server"
          :value="data.hostsCount"
        />
        <StatCard
          label="Sources"
          icon="i-lucide-database"
          :value="data.sourcesCount"
        />
      </div>

      <!-- Volume by level -->
      <StackedAreaChart
        v-if="data.volumeByLevel.length > 0"
        :series="data.volumeByLevel"
        :height="220"
      />
      <div v-else class="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-center text-neutral-500 text-sm">
        No data for the selected range.
      </div>

      <!-- 2-col grid : top hosts/sources + recent errors -->
      <div class="grid grid-cols-2 gap-4">
        <div class="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div class="px-3 py-2 border-b border-neutral-800 flex items-center gap-2">
            <h3 class="text-sm font-medium text-neutral-300">Distribution</h3>
            <UBadge variant="soft" size="xs">{{ range }}</UBadge>
          </div>
          <div class="p-3 space-y-3">
            <div>
              <div class="text-xs text-neutral-500 mb-1">Top hosts</div>
              <ul v-if="data.topHosts.length > 0" class="space-y-1">
                <li v-for="h in data.topHosts" :key="h.host" class="flex items-center gap-2 text-xs font-mono">
                  <span class="truncate flex-1">{{ h.host }}</span>
                  <span class="text-sky-300 tabular-nums">{{ h.volume.toFixed(0) }}</span>
                </li>
              </ul>
              <p v-else class="text-xs text-neutral-500">—</p>
            </div>
            <div>
              <div class="text-xs text-neutral-500 mb-1">Top sources</div>
              <ul v-if="data.topSources.length > 0" class="space-y-1">
                <li v-for="s in data.topSources" :key="s.source" class="flex items-center gap-2 text-xs font-mono">
                  <span class="truncate flex-1">{{ s.source }}</span>
                  <span class="text-sky-300 tabular-nums">{{ s.volume.toFixed(0) }}</span>
                </li>
              </ul>
              <p v-else class="text-xs text-neutral-500">—</p>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div class="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-medium text-neutral-300">Recent errors</h3>
              <UBadge :color="data.recentErrors.length > 0 ? 'error' : 'success'" variant="soft" size="xs">
                {{ data.recentErrors.length }}
              </UBadge>
            </div>
            <UButton size="xs" variant="ghost" icon="i-lucide-external-link" @click="openSearchErrors">Open in Search</UButton>
          </div>
          <div v-if="data.recentErrors.length === 0" class="p-6 text-center text-neutral-500 text-xs">
            No errors. ✨
          </div>
          <div v-else class="max-h-[480px] overflow-y-auto">
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
