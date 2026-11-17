import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' so it works on GitHub Pages with a custom domain or under /<repo>/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
})
