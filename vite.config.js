import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA talks to the API at VITE_API_URL (default :4000). In dev we also
// proxy /api so the app works without CORS config out of the box.
/**
 * The app stylesheet, made non-render-blocking.
 *
 * index.html paints a complete shell — bar, brand, hero shape — from styles
 * that are inline in the document. It cannot show any of it while a
 * `<link rel="stylesheet">` is still in flight, because one render-blocking
 * stylesheet blocks the whole first paint whether or not the pixels on screen
 * need it.
 *
 * Measured on Slow 4G before this: the stylesheet landed at 830 ms and the
 * first paint followed at 980 ms — 800 ms of white for a frame whose CSS was
 * already in the HTML. The shell was built to be on screen in frame one and was
 * not, and nothing in the shell's own code could have fixed it.
 *
 * `rel=preload as=style` fetches at the same priority without blocking, and
 * flips itself to a real stylesheet on load. The `<noscript>` copy keeps the
 * page styled with JavaScript off, where the flip can never happen.
 *
 * The risk this creates is the app rendering before its CSS applies. main.jsx
 * closes it by waiting for the sheet before mounting — see the gate there.
 */
const asyncAppCss = () => ({
  name: 'fm-async-app-css',
  enforce: 'post',
  transformIndexHtml(html) {
    return html.replace(
      /<link rel="stylesheet"([^>]*)href="([^"]+)"([^>]*)>/,
      (_m, before, href, after) => {
        const attrs = `${before}${after}`.trim();
        return `<link rel="preload" as="style" data-app-css href="${href}" ${attrs}`
          + ` onload="this.onload=null;this.rel='stylesheet'">`
          + `<noscript><link rel="stylesheet" href="${href}" ${attrs}></noscript>`;
      });
  },
});

export default defineConfig({
  plugins: [react(), asyncAppCss()],
  build: {
    /* Needed by scripts/prerender.mjs to turn "this route needs Shop.jsx" into
       the hashed chunk filename it must announce. Without it a lazy route costs
       an extra round trip that is only discovered once the main bundle runs. */
    manifest: true,
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
