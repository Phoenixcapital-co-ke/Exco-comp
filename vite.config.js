import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,
    allowedHosts: ['08ca6e2a4c93.ngrok-free.app', '52ebda284371.ngrok-free.app'],
  },
})

