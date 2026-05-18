<script setup lang="ts">
import type { Source, SourceType, SourceTypesCatalog } from '~/composables/useAdminApi'

interface Props {
  types: SourceTypesCatalog
  initialType?: SourceType
  initialConfig?: Record<string, unknown>
  saving?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  submit: [payload: { type: SourceType; config: Record<string, unknown> }]
  cancel: []
}>()

const selectedType = ref<SourceType>(props.initialType ?? 'pm2')
const config = ref<Record<string, unknown>>({ ...(props.initialConfig ?? {}) })
const error = ref<string | null>(null)

const typeItems = computed(() => {
  return Object.entries(props.types.definitions).map(([key, def]) => ({
    label: def.title,
    value: key,
    icon: def.icon,
    description: def.description
  }))
})

const schema = computed(() => props.types.definitions[selectedType.value])

const fields = computed(() => {
  if (!schema.value) return []
  return Object.entries(schema.value.properties)
    .filter(([key]) => key !== 'type')
    .map(([key, prop]) => ({
      key,
      title: prop.title ?? key,
      description: prop.description,
      type: prop.type ?? 'string',
      default: prop.default,
      required: schema.value!.required.includes(key)
    }))
})

watch(selectedType, (newType, oldType) => {
  if (newType === oldType) return
  // Reset config to defaults from the new type
  const newDef = props.types.definitions[newType]
  const fresh: Record<string, unknown> = {}
  for (const [k, p] of Object.entries(newDef?.properties ?? {})) {
    if (k === 'type') continue
    if (p.default !== undefined) fresh[k] = p.default
  }
  config.value = fresh
})

function onSubmit() {
  error.value = null
  // Quick validation
  for (const f of fields.value) {
    if (f.required && (config.value[f.key] === '' || config.value[f.key] === undefined || config.value[f.key] === null)) {
      error.value = `Champ requis : ${f.title}`
      return
    }
  }
  emit('submit', { type: selectedType.value, config: { ...config.value } })
}
</script>

<template>
  <div class="p-4 space-y-4">
    <UFormField label="Type de source">
      <USelect
        v-model="selectedType"
        :items="typeItems"
        :disabled="!!initialType"
        class="w-full"
      />
    </UFormField>

    <p v-if="schema" class="text-xs text-neutral-400">{{ schema.description }}</p>

    <template v-for="field in fields" :key="field.key">
      <UFormField :label="field.title + (field.required ? ' *' : '')" :description="field.description">
        <UInput
          v-if="field.type === 'string'"
          :model-value="(config[field.key] as string) ?? ''"
          @update:model-value="config[field.key] = $event"
          :placeholder="String(field.default ?? '')"
          class="w-full font-mono text-sm"
        />
        <UTextarea
          v-else-if="field.type === 'array'"
          :model-value="Array.isArray(config[field.key]) ? (config[field.key] as string[]).join('\n') : ''"
          @update:model-value="config[field.key] = $event.split('\n').map(s => s.trim()).filter(Boolean)"
          placeholder="une ligne par valeur"
          class="w-full font-mono text-sm"
        />
        <UTextarea
          v-else-if="field.type === 'object'"
          :model-value="JSON.stringify(config[field.key] ?? {}, null, 2)"
          @update:model-value="(v) => {
            try { config[field.key] = JSON.parse(v) } catch { /* ignore until valid */ }
          }"
          placeholder="{}"
          class="w-full font-mono text-xs"
          :rows="4"
        />
        <UInput
          v-else
          :model-value="config[field.key] as string ?? ''"
          @update:model-value="config[field.key] = $event"
          class="w-full"
        />
      </UFormField>
    </template>

    <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>

    <div class="flex items-center gap-2 pt-2">
      <UButton :loading="saving" @click="onSubmit">
        {{ initialType ? 'Mettre à jour' : 'Ajouter' }}
      </UButton>
      <UButton variant="ghost" @click="emit('cancel')">Annuler</UButton>
    </div>
  </div>
</template>
