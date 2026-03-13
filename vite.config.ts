/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
      '/health': { target: 'http://localhost:3001' },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
