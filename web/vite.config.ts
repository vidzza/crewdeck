import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' so it works on GitHub Pages with a custom domain or under /<repo>/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // A new id per build: the service worker is loaded as sw.js?v=<id>, so no cache (Cloudflare, browser)
  // can keep serving an old one after an update.
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  base: './',
})
