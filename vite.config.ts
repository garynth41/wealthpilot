/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const build = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1.$2')

/** 0.39.4: asset-manifest.json — every built file under assets/, which the service worker stores when a release installs (public/sw.js),
 *  so the app opens offline straight after an update. Written from what is on disk once the build has finished writing. */
const assetManifest = (): Plugin => ({ name: 'asset-manifest', apply: 'build', enforce: 'post', writeBundle(o) { const dir = o.dir || 'dist'
  writeFileSync(join(dir, 'asset-manifest.json'), JSON.stringify(readdirSync(join(dir, 'assets')).filter(f => !f.endsWith('.map')).sort().map(f => './assets/' + f))) } })

export default defineConfig({
  plugins: [react(), assetManifest()],
  base: './',                       // deploys from any sub-path (GitHub Pages /pocketledger/)
  define: { __APP_BUILD__: JSON.stringify(`${stamp}-${build}`) },
  build: { chunkSizeWarningLimit: 1600 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
