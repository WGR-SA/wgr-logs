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
</script>

<template>
  <section class="p-6 max-w-2xl mx-auto w-full overflow-y-auto">
    <h2 class="text-lg font-semibold mb-4">Réglages</h2>

    <div class="space-y-4">
      <UFormField label="Endpoint d'ingestion Loki" required>
        <UInput v-model="endpoint" placeholder="https://<INGEST_DOMAIN>" class="w-full" />
      </UFormField>

      <UFormField label="URL Grafana (pour Alertmanager)">
        <UInput v-model="grafanaUrl" placeholder="https://<LOGS_DOMAIN>" class="w-full" />
      </UFormField>

      <UFormField label="Token (INGEST_AUTH_TOKEN)" required>
        <UInput v-model="settings.token.value" type="password" class="w-full" />
      </UFormField>

      <UFormField label="Notifications natives sur alerte firing">
        <USwitch v-model="settings.notifyOnFiring.value" />
      </UFormField>

      <div class="flex items-center gap-3 pt-2">
        <UButton :loading="testStatus === 'idle' && false" @click="testConnection">
          Tester la connexion
        </UButton>
        <span v-if="testStatus === 'ok'" class="text-emerald-400 text-sm">{{ testMessage }}</span>
        <span v-if="testStatus === 'fail'" class="text-red-400 text-sm">{{ testMessage }}</span>
      </div>
    </div>
  </section>
</template>
