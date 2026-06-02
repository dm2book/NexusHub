import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA talks to the API at VITE_API_URL (default :4000). In dev we also
// proxy /api so the app works without CORS config out of the box.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
