<script setup lang="ts">
const settings = useSettingsStore()
const route = useRoute()
const initialQuery = (route.query.q as string) || '{app=~".+"}'
const query = ref(initialQuery)
const tail = useLiveTail(query)
</script>

<template>
  <section class="flex flex-col h-full min-h-0">
    <QueryBar v-model="query" />

    <div class="flex items-center gap-3 px-3 py-1 border-b border-neutral-800 text-xs text-neutral-400">
      <span class="flex items-center gap-1">
        <span
          class="size-2 rounded-full"
          :class="tail.connected.value ? 'bg-emerald-400' : 'bg-neutral-600'"
        />
        {{ tail.connected.value ? 'Connecté' : 'Déconnecté' }}
      </span>
      <span v-if="tail.error.value" class="text-red-400">{{ tail.error.value }}</span>
      <span class="ml-auto">{{ tail.entries.value.length }} ligne(s)</span>
      <UButton size="xs" variant="ghost" icon="i-lucide-eraser" @click="tail.clear()">
        Effacer
      </UButton>
    </div>

    <div v-if="!settings.endpoint.value" class="flex-1 flex items-center justify-center text-neutral-500">
      <div class="text-center">
        <UIcon name="i-lucide-settings-2" class="size-8 mx-auto mb-2" />
        <p class="text-sm">Configure l'endpoint et le token dans Réglages.</p>
        <UButton class="mt-3" to="/settings" size="sm">Ouvrir Réglages</UButton>
      </div>
    </div>

    <div v-else class="flex-1 overflow-y-auto">
      <LogLine
        v-for="entry in tail.entries.value"
        :key="entry.ts + entry.line"
        :ts="entry.ts"
        :line="entry.line"
        :labels="entry.labels"
      />
    </div>
  </section>
</template>
