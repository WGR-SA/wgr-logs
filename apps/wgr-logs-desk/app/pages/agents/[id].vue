<script setup lang="ts">
import type { Agent, Source, SourceType, SourceTypesCatalog } from '~/composables/useAdminApi'

const route = useRoute()
const router = useRouter()
const agentId = computed(() => route.params.id as string)

const agent = ref<Agent | null>(null)
const sources = ref<Source[]>([])
const typesCatalog = ref<SourceTypesCatalog | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const showAddForm = ref(false)
const editingSource = ref<Source | null>(null)
const savingSource = ref(false)

async function load() {
  const api = useAdminApi()
  if (!api) {
    error.value = 'Configure l\'admin API'
    return
  }
  loading.value = true
  error.value = null
  try {
    const [a, s, t] = await Promise.all([
      api.getAgent(agentId.value),
      api.listSources(agentId.value),
      typesCatalog.value ? Promise.resolve(typesCatalog.value) : api.sourceTypes()
    ])
    agent.value = a
    sources.value = s
    typesCatalog.value = t
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), 15_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

async function onSourceSubmit(payload: { type: SourceType; config: Record<string, unknown> }) {
  const api = useAdminApi()
  if (!api) return
  savingSource.value = true
  try {
    if (editingSource.value) {
      await api.updateSource(agentId.value, editingSource.value.id, { config: payload.config })
    } else {
      await api.createSource(agentId.value, payload)
    }
    showAddForm.value = false
    editingSource.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    savingSource.value = false
  }
}

async function toggleSource(s: Source) {
  const api = useAdminApi()
  if (!api) return
  try {
    await api.updateSource(agentId.value, s.id, { enabled: !s.enabled })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function deleteSource(s: Source) {
  if (!confirm(`Supprimer la source ${s.type} ?`)) return
  const api = useAdminApi()
  if (!api) return
  try {
    await api.deleteSource(agentId.value, s.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function deleteAgent() {
  if (!confirm(`Supprimer l'agent ${agent.value?.name} ? Toutes ses sources seront perdues.`)) return
  const api = useAdminApi()
  if (!api) return
  try {
    await api.deleteAgent(agentId.value)
    router.push('/agents')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function startEdit(s: Source) {
  editingSource.value = s
  showAddForm.value = true
}

function startAdd() {
  editingSource.value = null
  showAddForm.value = true
}

function getIcon(type: string): string {
  return typesCatalog.value?.definitions[type]?.icon ?? 'i-lucide-circle'
}

function summary(s: Source): string {
  const c = s.config
  if (s.type === 'pm2' && typeof c.path === 'string') return c.path
  if ((s.type === 'cakephp' || s.type === 'wordpress' || s.type === 'prestashop') && typeof c.base_dir === 'string') return c.base_dir
  if (s.type === 'files' && Array.isArray(c.paths)) return (c.paths as string[]).join(', ')
  return ''
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <UButton size="xs" variant="ghost" icon="i-lucide-arrow-left" to="/agents" />
      <h2 v-if="agent" class="text-sm font-semibold">{{ agent.name }}</h2>
      <span v-if="agent" class="text-xs text-neutral-500 font-mono">{{ agent.id.slice(0, 8) }}</span>
      <UBadge v-if="agent" :color="agent.status === 'active' ? 'success' : agent.status === 'pending' ? 'warning' : 'neutral'" variant="soft" size="xs">
        {{ agent.status }}
      </UBadge>
      <span v-if="error" class="text-red-400 text-xs">{{ error }}</span>
      <UButton class="ml-auto" size="xs" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" @click="load()" />
      <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteAgent" />
    </header>

    <div v-if="agent" class="px-4 py-3 border-b border-neutral-800 grid grid-cols-4 gap-3 text-xs">
      <div>
        <div class="text-neutral-500 mb-1">Hostname</div>
        <div class="font-mono">{{ agent.hostname ?? '—' }}</div>
      </div>
      <div>
        <div class="text-neutral-500 mb-1">Env</div>
        <div class="font-mono">{{ agent.env }}</div>
      </div>
      <div>
        <div class="text-neutral-500 mb-1">Shipper</div>
        <div class="font-mono">{{ agent.shipperKind ?? '—' }} {{ agent.shipperVer ? `v${agent.shipperVer}` : '' }}</div>
      </div>
      <div>
        <div class="text-neutral-500 mb-1">Dernière vue</div>
        <div class="font-mono">{{ agent.lastSeen ? new Date(agent.lastSeen).toLocaleString('fr-CH') : 'jamais' }}</div>
      </div>
    </div>

    <div class="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
      <h3 class="text-sm font-medium">Sources</h3>
      <UBadge variant="soft" size="xs">{{ sources.length }}</UBadge>
      <UButton class="ml-auto" size="xs" icon="i-lucide-plus" @click="startAdd">
        Ajouter une source
      </UButton>
    </div>

    <div v-if="showAddForm && typesCatalog" class="border-b border-neutral-800 bg-neutral-900/40">
      <SourceForm
        :types="typesCatalog"
        :initial-type="editingSource?.type as SourceType | undefined"
        :initial-config="editingSource?.config"
        :saving="savingSource"
        @submit="onSourceSubmit"
        @cancel="() => { showAddForm = false; editingSource = null }"
      />
    </div>

    <div v-if="sources.length === 0" class="flex-1 flex items-center justify-center text-neutral-500 text-sm p-6">
      Aucune source. Clique sur "Ajouter une source" pour commencer.
    </div>

    <ul v-else class="divide-y divide-neutral-800">
      <li
        v-for="s in sources"
        :key="s.id"
        class="px-4 py-3 flex items-center gap-3 hover:bg-neutral-900/40"
      >
        <UIcon :name="getIcon(s.type)" class="size-5 shrink-0 text-sky-300" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-sm">{{ typesCatalog?.definitions[s.type]?.title ?? s.type }}</span>
            <UBadge v-if="!s.enabled" variant="soft" size="xs" color="neutral">disabled</UBadge>
          </div>
          <div v-if="summary(s)" class="text-xs text-neutral-500 mt-0.5 font-mono truncate">{{ summary(s) }}</div>
        </div>
        <UButton size="xs" variant="ghost" :icon="s.enabled ? 'i-lucide-pause' : 'i-lucide-play'" @click="toggleSource(s)" />
        <UButton size="xs" variant="ghost" icon="i-lucide-pencil" @click="startEdit(s)" />
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="deleteSource(s)" />
      </li>
    </ul>
  </section>
</template>
