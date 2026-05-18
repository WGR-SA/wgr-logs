<script setup lang="ts">
interface Props {
  ts: string
  line: string
  labels: Record<string, string>
}
const props = defineProps<Props>()

const date = computed(() => {
  const ms = Number(props.ts.slice(0, 13))
  return new Date(ms).toLocaleTimeString('fr-CH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
})

const parsed = computed(() => {
  const trimmed = props.line.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
})

const level = computed(() => {
  return (props.labels.level ?? (parsed.value?.level as string) ?? 'info').toLowerCase()
})

const levelClass = computed(() => {
  switch (level.value) {
    case 'error':
    case 'fatal': return 'text-red-400'
    case 'warn':
    case 'warning': return 'text-amber-400'
    case 'debug': return 'text-neutral-500'
    default: return 'text-sky-300'
  }
})
</script>

<template>
  <div class="font-mono text-xs leading-5 px-3 py-1 hover:bg-neutral-900/50 flex gap-3 items-start">
    <span class="text-neutral-500 shrink-0">{{ date }}</span>
    <span :class="levelClass" class="shrink-0 uppercase w-12">{{ level }}</span>
    <span class="text-neutral-400 shrink-0">{{ labels.app ?? '?' }}</span>
    <span class="text-neutral-200 break-all">
      <template v-if="parsed">{{ parsed.msg ?? line }}</template>
      <template v-else>{{ line }}</template>
    </span>
  </div>
</template>
