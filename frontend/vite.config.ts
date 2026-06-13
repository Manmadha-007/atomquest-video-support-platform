import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const cacheDir = process.env.VITE_CACHE_DIR

// https://vite.dev/config/
export default defineConfig({
  ...(cacheDir ? { cacheDir } : {}),
  plugins: [react(), tailwindcss()],
})
