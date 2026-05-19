<script setup lang="ts">
const route = useRoute()
const settings = useSettingsStore()
const alerts = useAlertWatcher()

const items = [
  { label: 'Dashboard', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Apps', to: '/apps', icon: 'i-lucide-boxes' },
  { label: 'Live', to: '/live', icon: 'i-lucide-radio' },
  { label: 'Recherche', to: '/search', icon: 'i-lucide-search' },
  { label: 'Alertes', to: '/alerts', icon: 'i-lucide-bell' },
  { label: 'Agents', to: '/agents', icon: 'i-lucide-cpu' }
]

const firingCount = computed(() => alerts.firing.value.length)
</script>

<template>
  <header class="flex items-center gap-4 px-4 h-12 border-b border-neutral-800 shrink-0">
    <NuxtLink to="/" class="font-semibold tracking-tight">
      WGR <span class="text-sky-400">Logs</span>
    </NuxtLink>

    <nav class="flex items-center gap-1">
      <UButton
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        variant="ghost"
        :color="route.path === item.to ? 'primary' : 'neutral'"
        size="sm"
      >
        {{ item.label }}
        <UBadge
          v-if="item.to === '/alerts' && firingCount > 0"
          color="error"
          variant="solid"
          size="xs"
          class="ml-1"
        >
          {{ firingCount }}
        </UBadge>
      </UButton>
    </nav>

    <div class="ml-auto flex items-center gap-2 text-xs text-neutral-400">
      <span v-if="settings.endpoint.value">
        {{ settings.endpoint.value }}
      </span>
      <UButton
        to="/settings"
        icon="i-lucide-settings"
        variant="ghost"
        color="neutral"
        size="xs"
      />
    </div>
  </header>
</template>
