<script setup lang="ts">
const settings = useSettingsStore()
const { data, refresh } = useAppsList()
const router = useRouter()

const filter = ref('')
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return data.apps
  return data.apps.filter((a) =>
    a.app.toLowerCase().includes(q) ||
    a.framework.toLowerCase().includes(q) ||
    a.host.toLowerCase().includes(q)
  )
})

function open(app: string) {
  router.push(`/apps/${encodeURIComponent(app)}`)
}

function formatVol(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
  return String(v)
}

function frameworkColor(fw: string) {
  switch (fw) {
    case 'cakephp': case 'cakephp2': case 'cakephp3': return 'warning'
    case 'wordpress': return 'primary'
    case 'prestashop': case 'symfony': case 'laravel': return 'info'
    case 'nginx': return 'success'
    case 'pm2': return 'secondary'
    default: return 'neutral'
  }
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <h2 class="text-sm font-semibold">Apps</h2>
      <UBadge variant="soft" size="xs">{{ filtered.length }} / {{ data.apps.length }}</UBadge>
      <UInput
        v-model="filter"
        placeholder="Filter app, framework, host…"
        size="xs"
        icon="i-lucide-search"
        class="ml-3 w-72"
      />
      <span v-if="data.error" class="text-red-400 text-xs">{{ data.error }}</span>
      <UButton
        class="ml-auto"
        size="xs"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="data.loading"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </header>

    <div v-if="!settings.endpoint.value" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      <div class="text-center">
        <UIcon name="i-lucide-settings-2" class="size-8 mx-auto mb-2" />
        <p>Configure Loki endpoint + token in Settings first.</p>
        <UButton class="mt-3" to="/settings" size="sm">Open Settings</UButton>
      </div>
    </div>

    <div v-else-if="data.apps.length === 0 && !data.loading" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      No apps with logs in the last hour.
    </div>

    <ul v-else class="divide-y divide-neutral-800">
      <li
        v-for="row in filtered"
        :key="row.app + row.host + row.source"
        class="px-4 py-3 hover:bg-neutral-900/60 cursor-pointer group"
        @click="open(row.app)"
      >
        <div class="flex items-center gap-3">
          <span class="font-mono text-sm text-neutral-100 truncate flex-1">{{ row.app }}</span>
          <UBadge v-if="row.framework" variant="soft" :color="frameworkColor(row.framework)" size="xs">{{ row.framework }}</UBadge>
          <span class="text-xs text-neutral-500">{{ row.host }}</span>
          <span class="text-xs text-neutral-500">{{ row.source }}</span>

          <div class="flex items-center gap-3 w-44 justify-end">
            <span class="text-xs font-mono text-sky-300 tabular-nums">
              {{ formatVol(row.volume) }} <span class="text-neutral-500">lines</span>
            </span>
            <span
              class="text-xs font-mono tabular-nums w-16 text-right"
              :class="row.errors > 0 ? 'text-red-400' : 'text-neutral-600'"
            >
              {{ formatVol(row.errors) }} <span class="text-neutral-500">err</span>
            </span>
          </div>
          <UIcon name="i-lucide-chevron-right" class="text-neutral-600 shrink-0" />
        </div>
      </li>
    </ul>
  </section>
</template>
