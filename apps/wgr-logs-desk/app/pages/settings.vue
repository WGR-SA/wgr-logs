<script setup lang="ts">
const settings = useSettingsStore()

const endpoint = computed({
  get: () => settings.endpoint.value,
  set: (v) => { settings.endpoint.value = v.replace(/\/$/, '') }
})
const grafanaUrl = computed({
  get: () => settings.grafanaUrl.value,
  set: (v) => { settings.grafanaUrl.value = v.replace(/\/$/, '') }
})
const adminApiUrl = computed({
  get: () => settings.adminApiUrl.value,
  set: (v) => { settings.adminApiUrl.value = v.replace(/\/$/, '') }
})

const testStatus = ref<'idle' | 'ok' | 'fail'>('idle')
const testMessage = ref('')

async function testConnection() {
  testStatus.value = 'idle'
  const client = useLokiClient()
  if (!client) {
    testStatus.value = 'fail'
    testMessage.value = 'Endpoint ou token manquant'
    return
  }
  try {
    const labels = await client.labels()
    testStatus.value = 'ok'
    testMessage.value = `${labels.length} label(s) disponibles : ${labels.slice(0, 5).join(', ')}…`
  } catch (e) {
    testStatus.value = 'fail'
    testMessage.value = e instanceof Error ? e.message : String(e)
  }
}

const adminTestStatus = ref<'idle' | 'ok' | 'fail'>('idle')
const adminTestMessage = ref('')

async function testAdminApi() {
  adminTestStatus.value = 'idle'
  const api = useAdminApi()
  if (!api) {
    adminTestStatus.value = 'fail'
    adminTestMessage.value = 'URL ou token admin manquant'
    return
  }
  try {
    const h = await api.health()
    const agents = await api.listAgents()
    adminTestStatus.value = 'ok'
    adminTestMessage.value = `API ${h.status}, ${agents.length} agent(s) enregistré(s)`
  } catch (e) {
    adminTestStatus.value = 'fail'
    adminTestMessage.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <section class="p-6 max-w-2xl mx-auto w-full overflow-y-auto">
    <h2 class="text-lg font-semibold mb-4">Réglages</h2>

    <div class="space-y-4">
      <UFormField label="Endpoint d'ingestion Loki" required>
        <UInput v-model="endpoint" placeholder="https://ingest.example.com" class="w-full" />
      </UFormField>

      <UFormField label="URL Grafana (pour Alertmanager)">
        <UInput v-model="grafanaUrl" placeholder="https://logs.example.com" class="w-full" />
      </UFormField>

      <UFormField label="Token (INGEST_AUTH_TOKEN)" required>
        <UInput v-model="settings.token.value" type="password" class="w-full" />
      </UFormField>

      <UFormField label="Notifications natives sur alerte firing">
        <USwitch v-model="settings.notifyOnFiring.value" />
      </UFormField>

      <div class="flex items-center gap-3 pt-2">
        <UButton @click="testConnection">Tester Loki</UButton>
        <span v-if="testStatus === 'ok'" class="text-emerald-400 text-sm">{{ testMessage }}</span>
        <span v-if="testStatus === 'fail'" class="text-red-400 text-sm">{{ testMessage }}</span>
      </div>

      <hr class="border-neutral-800 my-4" />

      <h3 class="text-base font-semibold">Management API</h3>
      <p class="text-xs text-neutral-400 -mt-3">Pour piloter les agents et leurs sources depuis cet écran. Optionnel.</p>

      <UFormField label="URL admin API" description="Ex: https://logs.example.com/mgmt">
        <UInput v-model="adminApiUrl" placeholder="https://logs.example.com/mgmt" class="w-full" />
      </UFormField>

      <UFormField label="Token admin (WGR_API_ADMIN_TOKEN)">
        <UInput v-model="settings.adminToken.value" type="password" class="w-full" />
      </UFormField>

      <div class="flex items-center gap-3 pt-2">
        <UButton @click="testAdminApi">Tester admin API</UButton>
        <span v-if="adminTestStatus === 'ok'" class="text-emerald-400 text-sm">{{ adminTestMessage }}</span>
        <span v-if="adminTestStatus === 'fail'" class="text-red-400 text-sm">{{ adminTestMessage }}</span>
      </div>
    </div>
  </section>
</template>
