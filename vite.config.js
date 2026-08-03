import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA talks to the API at VITE_API_URL (default :4000). In dev we also
// proxy /api so the app works without CORS config out of the box.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Keep the framework in its own chunk.
         *
         * React, the DOM renderer and the router change only when they are
         * upgraded, while the app changes on every deploy. Bundled together,
         * one copy fix invalidated 130KB of gzipped JavaScript for every
         * returning visitor. Split, that cache survives.
         *
         * Icons get the same treatment for the same reason, and because they
         * are the one dependency that grows quietly as pages are added.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('react-router')) return 'router';
          if (id.includes('lucide-react')) return 'icons';
        },
      },
    },
    // Every byte here is on the critical path, so it is worth knowing when a
    // chunk grows past the point where it hurts.
    chunkSizeWarningLimit: 250,
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
