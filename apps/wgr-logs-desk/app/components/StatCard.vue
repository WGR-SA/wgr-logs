<script setup lang="ts">
interface Props {
  label: string
  value: number | string
  icon?: string
  tone?: 'default' | 'success' | 'warn' | 'error'
  unit?: string
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  tone: 'default'
})

const toneClass = computed(() => {
  switch (props.tone) {
    case 'success': return 'text-emerald-400'
    case 'warn': return 'text-amber-400'
    case 'error': return 'text-red-400'
    default: return 'text-sky-300'
  }
})

const formatted = computed(() => {
  if (typeof props.value === 'string') return props.value
  const n = props.value
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toLocaleString('fr-CH', { maximumFractionDigits: 1 })
})
</script>

<template>
  <div class="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col gap-1">
    <div class="flex items-center gap-2 text-xs text-neutral-400">
      <UIcon v-if="icon" :name="icon" class="size-4" />
      <span>{{ label }}</span>
    </div>
    <div class="flex items-baseline gap-1">
      <span class="text-2xl font-semibold tabular-nums" :class="toneClass">
        <template v-if="loading">—</template>
        <template v-else>{{ formatted }}</template>
      </span>
      <span v-if="unit && !loading" class="text-xs text-neutral-500">{{ unit }}</span>
    </div>
  </div>
</template>
