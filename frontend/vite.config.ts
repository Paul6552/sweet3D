import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Im Dev-Modus laufen die API-Aufrufe über den Proxy zum Quarkus-Backend (Port 8180).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8180',
    },
  },
})
