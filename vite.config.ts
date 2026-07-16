import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildDefines } from './build-info.mjs'

function relayPortPlugin() {
  return {
    name: 'relay-port',
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use('/relay-port', (_req, res) => {
        let port = process.env.VITE_RELAY_PORT ?? process.env.RELAY_PORT ?? '8080'
        if (existsSync('.relay-port')) {
          port = readFileSync('.relay-port', 'utf8').trim()
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ port }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), relayPortPlugin()],
  define: buildDefines(),
  resolve: {
    dedupe: ['@trystero-p2p/core'],
    // The app consumes the workspace package from source; published consumers
    // get dist/. Order matters: the subpath alias must precede the bare one.
    alias: [
      { find: '@peerly/core/react', replacement: fileURLToPath(new URL('./packages/core/src/react.ts', import.meta.url)) },
      { find: '@peerly/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
    ],
  },
})