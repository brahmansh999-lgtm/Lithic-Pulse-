import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import aiRenderPlugin from './server/aiRenderMiddleware.js'

export default defineConfig(({ mode }) => {
  // Load .env into process.env so the AI-render middleware can read provider
  // keys server-side. '' prefix = load all keys (not just VITE_), but since
  // we only copy these specific ones into process.env, none of them reach
  // the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')
  // Stability AI key for /api/ai-render (Style Transfer / SDXL / SD3.5).
  process.env.STABILITY_API_KEY = env.STABILITY_API_KEY || process.env.STABILITY_API_KEY || ''
  // Cloudflare Workers AI credentials for the /api/ai-design LLM assistant.
  process.env.CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || ''
  process.env.CF_API_TOKEN  = env.CF_API_TOKEN  || process.env.CF_API_TOKEN  || ''

  return {
  plugins: [react(), aiRenderPlugin()],
  server: {
    port: 5200,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/'))               return 'three-core';
          if (id.includes('@react-three/fiber'))                return 'r3f';
          if (id.includes('@react-three/drei'))                 return 'drei';
          if (id.includes('@react-three/postprocessing') ||
              id.includes('postprocessing'))                    return 'postprocessing';
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  }
})
