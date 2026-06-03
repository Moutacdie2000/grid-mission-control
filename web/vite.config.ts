import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En dev, le front (5173) proxifie les appels /api vers le backend Fastify (8787),
// y compris le flux SSE /api/stream. En production, le backend sert directement
// le build statique, donc aucun proxy n'est nécessaire.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
