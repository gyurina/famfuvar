import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

const vendorChunks: Record<string, string[]> = {
  'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
  'vendor-supabase': ['@supabase/supabase-js'],
  'vendor-dexie':    ['dexie'],
  'vendor-datefns':  ['date-fns'],
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          for (const [chunk, deps] of Object.entries(vendorChunks)) {
            if (deps.some(dep => id.includes(`/node_modules/${dep}/`))) return chunk
          }
        },
      },
    },
  },
})
