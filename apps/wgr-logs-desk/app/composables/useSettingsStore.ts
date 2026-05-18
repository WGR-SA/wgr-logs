import { LazyStore } from '@tauri-apps/plugin-store'

interface Settings {
  endpoint: string          // e.g. https://ingest.example.com
  grafanaUrl: string        // e.g. https://logs.example.com
  token: string             // INGEST_AUTH_TOKEN
  adminApiUrl: string       // e.g. https://logs.example.com/mgmt
  adminToken: string        // WGR_API_ADMIN_TOKEN
  notifyOnFiring: boolean
}

const DEFAULTS: Settings = {
  endpoint: '',
  grafanaUrl: '',
  token: '',
  adminApiUrl: '',
  adminToken: '',
  notifyOnFiring: true
}

const STORE_FILE = 'settings.json'

let storePromise: Promise<LazyStore> | null = null
const state = reactive<Settings>({ ...DEFAULTS })
const loaded = ref(false)

async function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new LazyStore(STORE_FILE)
      const keys = Object.keys(DEFAULTS) as Array<keyof Settings>
      for (const key of keys) {
        const v = await store.get(key)
        if (v !== undefined && v !== null) (state as any)[key] = v
      }
      loaded.value = true
      return store
    })()
  }
  return storePromise
}

async function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  state[key] = value
  const store = await getStore()
  await store.set(key, value)
  await store.save()
}

export function useSettingsStore() {
  if (!storePromise) void getStore()
  return {
    loaded: readonly(loaded),
    endpoint: computed({ get: () => state.endpoint, set: (v) => void set('endpoint', v) }),
    grafanaUrl: computed({ get: () => state.grafanaUrl, set: (v) => void set('grafanaUrl', v) }),
    token: computed({ get: () => state.token, set: (v) => void set('token', v) }),
    adminApiUrl: computed({ get: () => state.adminApiUrl, set: (v) => void set('adminApiUrl', v) }),
    adminToken: computed({ get: () => state.adminToken, set: (v) => void set('adminToken', v) }),
    notifyOnFiring: computed({ get: () => state.notifyOnFiring, set: (v) => void set('notifyOnFiring', v) }),
    set
  }
}
