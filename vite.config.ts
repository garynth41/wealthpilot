/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

const build = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1.$2')

export default defineConfig({
  plugins: [react()],
  base: './',                       // deploys from any sub-path (GitHub Pages /pocketledger/)
  define: { __APP_BUILD__: JSON.stringify(`${stamp}-${build}`) },
  build: { chunkSizeWarningLimit: 1600 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
