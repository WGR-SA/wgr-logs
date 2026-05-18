<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  loading?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const input = ref(props.modelValue)
watch(() => props.modelValue, (v) => { input.value = v })

function onSubmit() {
  emit('update:modelValue', input.value)
  emit('submit')
}
</script>

<template>
  <form class="flex gap-2 items-center px-3 py-2 border-b border-neutral-800" @submit.prevent="onSubmit">
    <UIcon name="i-lucide-terminal" class="text-neutral-500 shrink-0" />
    <input
      v-model="input"
      class="flex-1 bg-transparent outline-none font-mono text-sm placeholder:text-neutral-600"
      :placeholder="placeholder ?? '{app=&quot;wgr-clip&quot;, env=&quot;prod&quot;}'"
      spellcheck="false"
      autocomplete="off"
    >
    <UButton
      type="submit"
      :loading="loading"
      :disabled="!input.trim()"
      size="sm"
      icon="i-lucide-play"
    >
      Exécuter
    </UButton>
  </form>
</template>
