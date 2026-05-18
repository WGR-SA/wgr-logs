// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  // SSR is left enabled (Nuxt 4 dev's vite-node IPC misbehaves with ssr:false).
  // For Tauri we run `nuxt generate`, which prerenders every route to static
  // HTML — the bundled webview gets the same SPA result either way.

  devtools: {
    enabled: false
  },

  app: {
    head: {
      title: 'WGR Logs',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  // Force a real static SPA output for `nuxt generate`. (See wgr-clip note.)
  nitro: {
    preset: 'static'
  },

  routeRules: {
    '/': { prerender: true },
    '/live': { prerender: true },
    '/search': { prerender: true },
    '/alerts': { prerender: true },
    '/agents': { prerender: true },
    '/agents/**': { ssr: false },
    '/settings': { prerender: true }
  },

  vite: {
    clearScreen: false
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
