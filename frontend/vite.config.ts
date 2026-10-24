import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The FastAPI backend (backend/, default port 8000) is reached through /api, so the browser
// never needs CORS or any provider configuration. Override with COURTROOM_API_URL.
const apiTarget = process.env.COURTROOM_API_URL ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': apiTarget } },
  preview: { proxy: { '/api': apiTarget } },
})
