<script setup lang="ts">
import type { Problem, ProblemStatus, Remediation, RemediationStatus } from '~/composables/useAdminApi'

const route = useRoute()
const project = computed(() => decodeURIComponent(String(route.params.project)))

const problems = ref<Problem[]>([])
const remediations = ref<Remediation[]>([])
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
    const [p, r] = await Promise.all([
      client.listProblems(project.value),
      client.listRemediations(project.value),
    ])
    problems.value = p
    remediations.value = r
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

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const PROBLEM_STATUS: Record<ProblemStatus, { label: string; color: BadgeColor }> = {
  open: { label: 'ouvert', color: 'neutral' },
  fixing: { label: 'en cours', color: 'warning' },
  pr: { label: 'PR', color: 'info' },
  merged: { label: 'corrigé', color: 'success' },
  wontfix: { label: 'ignoré', color: 'neutral' },
}

const REMEDIATION_STATUS: Record<RemediationStatus, { label: string; color: BadgeColor }> = {
  open: { label: 'en attente', color: 'neutral' },
  fixing: { label: 'en cours', color: 'warning' },
  pr_open: { label: 'PR ouverte', color: 'info' },
  needs_input: { label: 'attente retour', color: 'warning' },
  changes_requested: { label: 'corrections demandées', color: 'warning' },
  merged: { label: 'mergée', color: 'success' },
  wontfix: { label: 'abandonnée', color: 'neutral' },
  failed: { label: 'échec', color: 'error' },
}

function ago(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}j`
}
</script>

<template>
  <section class="flex flex-col h-full min-h-0 overflow-y-auto">
    <header class="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 shrink-0">
      <UButton to="/medic" size="xs" variant="ghost" icon="i-lucide-arrow-left" color="neutral" />
      <h2 class="text-sm font-semibold font-mono">{{ project }}</h2>
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

    <!-- Remédiations -->
    <div class="px-4 py-2 border-b border-neutral-800 flex items-center gap-2 shrink-0">
      <UIcon name="i-lucide-wrench" class="size-4 text-neutral-500" />
      <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Remédiations</h3>
      <UBadge variant="soft" size="xs">{{ remediations.length }}</UBadge>
    </div>

    <p v-if="remediations.length === 0 && !loading" class="px-4 py-3 text-xs text-neutral-500">
      Aucune remédiation. Lance <code>wgr-logs-medic fix</code> ou <code>auto</code> pour ouvrir une PR.
    </p>

    <ul v-else class="divide-y divide-neutral-800">
      <li v-for="r in remediations" :key="r.id" class="px-4 py-3 flex flex-col gap-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge :color="REMEDIATION_STATUS[r.status].color" variant="soft" size="xs">
            {{ REMEDIATION_STATUS[r.status].label }}
          </UBadge>
          <span v-if="r.problem" class="text-sm font-medium truncate">{{ r.problem.category }}</span>
          <UBadge v-if="r.costUsd > 0" variant="soft" size="xs" color="neutral">${{ r.costUsd.toFixed(2) }}</UBadge>
          <span v-if="r.diffStat" class="text-xs font-mono text-neutral-500">{{ r.diffStat }}</span>
          <span class="text-xs text-neutral-600 ml-auto">il y a {{ ago(r.updatedAt) }}</span>
        </div>

        <p v-if="r.summary" class="text-xs text-neutral-400">{{ r.summary }}</p>

        <div v-if="r.pendingComment" class="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-900/40 rounded px-2 py-1">
          <span class="font-semibold">Retour PR :</span> {{ r.pendingComment }}
        </div>

        <div v-if="r.notVerified" class="text-xs text-orange-300/80">
          <UIcon name="i-lucide-triangle-alert" class="size-3 inline" /> non vérifié : {{ r.notVerified }}
        </div>

        <div class="flex items-center gap-3 text-xs text-neutral-500">
          <span v-if="r.branch" class="font-mono">{{ r.branch }}</span>
          <UButton
            v-if="r.prUrl"
            :to="r.prUrl"
            target="_blank"
            external
            size="xs"
            variant="link"
            color="info"
            icon="i-lucide-external-link"
          >
            PR{{ r.prNumber ? ` #${r.prNumber}` : '' }}
          </UButton>
        </div>
      </li>
    </ul>

    <!-- Problèmes -->
    <div class="px-4 py-2 border-y border-neutral-800 flex items-center gap-2 shrink-0">
      <UIcon name="i-lucide-bug" class="size-4 text-neutral-500" />
      <h3 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Problèmes</h3>
      <UBadge variant="soft" size="xs">{{ problems.length }}</UBadge>
    </div>

    <p v-if="problems.length === 0 && !loading" class="px-4 py-3 text-xs text-neutral-500">
      Aucun problème détecté pour ce projet.
    </p>

    <ul v-else class="divide-y divide-neutral-800">
      <li v-for="p in problems" :key="p.id" class="px-4 py-3 flex flex-col gap-1">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge :color="PROBLEM_STATUS[p.status].color" variant="soft" size="xs">
            {{ PROBLEM_STATUS[p.status].label }}
          </UBadge>
          <span class="text-sm font-medium">{{ p.category }}</span>
          <UBadge v-if="p.tech" variant="soft" size="xs" color="neutral">{{ p.tech }}</UBadge>
          <UBadge variant="soft" size="xs" color="neutral">×{{ p.count }}</UBadge>
          <span class="text-xs text-neutral-600 ml-auto" :title="`fixability ${p.fixabilityScore}`">
            fix {{ p.fixabilityScore.toFixed(2) }}
          </span>
        </div>
        <div v-if="p.file" class="text-xs font-mono text-neutral-500">
          {{ p.file }}<span v-if="p.line != null">:{{ p.line }}</span>
        </div>
        <p class="text-xs font-mono text-neutral-400 line-clamp-2">{{ p.sample }}</p>
      </li>
    </ul>
  </section>
</template>
