<script setup lang="ts">
import type { Agent } from '~/composables/useAdminApi'

const settings = useSettingsStore()
const api = useAdminApi()
const agents = ref<Agent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function refresh() {
  const client = useAdminApi()
  if (!client) {
    error.value = 'Configure l\'admin API dans Réglages'
    return
  }
  loading.value = true
  error.value = null
  try {
    agents.value = await client.listAgents()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 15_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

function lastSeenLabel(a: Agent): string {
  if (!a.lastSeen) return 'jamais'
  const diff = (Date.now() - new Date(a.lastSeen).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}j`
}

function statusColor(s: Agent['status']) {
  if (s === 'active') return 'success'
  if (s === 'pending') return 'warning'
  return 'neutral'
}

function isOnline(a: Agent): boolean {
  if (!a.lastSeen) return false
  return (Date.now() - new Date(a.lastSeen).getTime()) < 180_000 // 3min
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <h2 class="text-sm font-semibold">Agents</h2>
      <UBadge variant="soft" size="xs">{{ agents.length }}</UBadge>
      <span v-if="error" class="text-red-400 text-xs">{{ error }}</span>
      <UButton
        class="ml-auto"
        size="xs"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="refresh()"
      >
        Rafraîchir
      </UButton>
    </header>

    <div v-if="!settings.adminApiUrl.value || !settings.adminToken.value" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      <div class="text-center">
        <UIcon name="i-lucide-key-round" class="size-8 mx-auto mb-2" />
        <p>Renseigne l'URL admin (<code>https://logs.example.com/mgmt</code>) et le token admin dans Réglages.</p>
        <UButton class="mt-3" to="/settings" size="sm">Ouvrir Réglages</UButton>
      </div>
    </div>

    <div v-else-if="agents.length === 0 && !loading" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      <div class="text-center">
        <UIcon name="i-lucide-cpu" class="size-8 mx-auto mb-2" />
        <p>Aucun agent enregistré.</p>
        <p class="text-xs mt-1">Déploie un shipper avec le register token pour qu'il apparaisse ici.</p>
      </div>
    </div>

    <ul v-else class="divide-y divide-neutral-800">
      <li
        v-for="agent in agents"
        :key="agent.id"
        class="group flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/60 cursor-pointer"
        @click="$router.push(`/agents/${agent.id}`)"
      >
        <span
          class="size-2 rounded-full shrink-0"
          :class="isOnline(agent) ? 'bg-emerald-400' : 'bg-neutral-600'"
          :title="isOnline(agent) ? 'En ligne' : 'Hors ligne'"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-sm">{{ agent.name }}</span>
            <UBadge variant="soft" size="xs" color="neutral">{{ agent.shipperKind ?? 'unknown' }}</UBadge>
            <UBadge :color="statusColor(agent.status)" variant="soft" size="xs">{{ agent.status }}</UBadge>
          </div>
          <div class="text-xs text-neutral-500 mt-0.5 flex items-center gap-3">
            <span v-if="agent.hostname" class="font-mono">{{ agent.hostname }}</span>
            <span>env={{ agent.env }}</span>
            <span>{{ agent.sources?.length ?? 0 }} sources</span>
            <span>vu il y a {{ lastSeenLabel(agent) }}</span>
          </div>
        </div>
        <UIcon name="i-lucide-chevron-right" class="text-neutral-600 shrink-0" />
      </li>
    </ul>
  </section>
</template>
