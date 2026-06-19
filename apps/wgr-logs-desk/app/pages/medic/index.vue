<script setup lang="ts">
import type { ProjectOverview } from '~/composables/useAdminApi'

const settings = useSettingsStore()
const projects = ref<ProjectOverview[]>([])
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
    projects.value = await client.listProjects()
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
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <h2 class="text-sm font-semibold">Medic</h2>
      <UBadge variant="soft" size="xs">{{ projects.length }}</UBadge>
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

    <div v-else-if="projects.length === 0 && !loading" class="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      <div class="text-center">
        <UIcon name="i-lucide-stethoscope" class="size-8 mx-auto mb-2" />
        <p>Aucun projet suivi par le medic.</p>
        <p class="text-xs mt-1">Lance un scan (<code>wgr-logs-medic scan</code>) pour faire remonter les problèmes ici.</p>
      </div>
    </div>

    <ul v-else class="divide-y divide-neutral-800">
      <li
        v-for="p in projects"
        :key="p.name"
        class="group flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/60 cursor-pointer"
        @click="$router.push(`/medic/${encodeURIComponent(p.name)}`)"
      >
        <UIcon name="i-lucide-folder-git-2" class="size-4 text-neutral-500 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm">{{ p.name }}</span>
            <UBadge variant="soft" size="xs" color="neutral">
              {{ p.problemsOpen }}/{{ p.problemsTotal }} problèmes
            </UBadge>
            <UBadge v-if="p.changesRequested > 0" color="warning" variant="soft" size="xs">
              {{ p.changesRequested }} à traiter
            </UBadge>
            <UBadge v-if="p.prOpen > 0" color="info" variant="soft" size="xs">
              {{ p.prOpen }} PR
            </UBadge>
            <UBadge v-if="p.merged > 0" color="success" variant="soft" size="xs">
              {{ p.merged }} mergées
            </UBadge>
            <UBadge v-if="p.failed > 0" color="error" variant="soft" size="xs">
              {{ p.failed }} échecs
            </UBadge>
          </div>
        </div>
        <UIcon name="i-lucide-chevron-right" class="text-neutral-600 shrink-0" />
      </li>
    </ul>
  </section>
</template>
