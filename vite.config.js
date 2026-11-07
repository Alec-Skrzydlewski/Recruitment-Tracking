import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@app-runtime': fileURLToPath(new URL(mode === 'demo' ? './src/demo/DemoApp.jsx' : './src/live/LiveApp.jsx', import.meta.url)),
    },
  },
}))
