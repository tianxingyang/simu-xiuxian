/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3001' },
      '/health': { target: 'http://localhost:3001' },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
