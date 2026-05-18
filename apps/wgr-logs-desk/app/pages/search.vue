<script setup lang="ts">
import type { LokiQueryRangeResponse } from '@wgr/logs-client'

const settings = useSettingsStore()
const route = useRoute()
const initialQuery = (route.query.q as string) || '{app=~".+"} |= "error"'
const query = ref(initialQuery)
const loading = ref(false)
const result = ref<LokiQueryRangeResponse | null>(null)
const errorMsg = ref<string | null>(null)

const since = ref(60)

const flat = computed(() => {
  const out: Array<{ ts: string; line: string; labels: Record<string, string> }> = []
  for (const r of result.value?.data.result ?? []) {
    const labels = r.stream ?? {}
    for (const [ts, line] of r.values ?? []) out.push({ ts, line, labels })
  }
  return out.sort((a, b) => Number(b.ts) - Number(a.ts))
})

async function runQuery() {
  const client = useLokiClient()
  if (!client) {
    errorMsg.value = 'Configurer endpoint + token'
    return
  }
  loading.value = true
  errorMsg.value = null
  try {
    const end = Date.now()
    const start = end - since.value * 60_000
    result.value = await client.queryRange({
      query: query.value,
      start,
      end,
      limit: 1000
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0">
    <QueryBar v-model="query" :loading="loading" @submit="runQuery" />

    <div class="flex items-center gap-3 px-3 py-2 border-b border-neutral-800 text-xs">
      <label class="text-neutral-400">Fenêtre :</label>
      <USelect
        v-model="since"
        :items="[
          { label: '15 min', value: 15 },
          { label: '1 h', value: 60 },
          { label: '6 h', value: 360 },
          { label: '24 h', value: 1440 },
          { label: '7 j', value: 10080 }
        ]"
        size="xs"
      />
      <span v-if="errorMsg" class="text-red-400 ml-2">{{ errorMsg }}</span>
      <span class="ml-auto text-neutral-500">{{ flat.length }} ligne(s)</span>
    </div>

    <div v-if="!settings.endpoint.value" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      Configure d'abord les Réglages.
    </div>

    <div v-else class="flex-1 overflow-y-auto">
      <LogLine
        v-for="entry in flat"
        :key="entry.ts + entry.line"
        :ts="entry.ts"
        :line="entry.line"
        :labels="entry.labels"
      />
      <div v-if="!loading && flat.length === 0" class="p-6 text-center text-neutral-500 text-sm">
        Aucune ligne. Lance la query.
      </div>
    </div>
  </section>
</template>
