import { readFileSync, existsSync } from 'fs'
import { createHmac } from 'node:crypto'
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

function e2eRendezvousPlugin() {
  return {
    name: 'e2e-rendezvous',
    configureServer(server: { middlewares: Connect.Server }) {
      if (process.env.VITE_E2E_AUTH_BYPASS !== 'true') return
      server.middlewares.use('/api/rendezvous/lookup', (req, res) => {
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          try {
            const email = String(JSON.parse(body).email ?? '').trim().toLowerCase()
            if (!email) throw new Error('missing email')
            const rendezvousId = createHmac('sha256', 'peerly-e2e-rendezvous-only')
              .update(email)
              .digest('base64url')
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify({ rendezvousId }))
          } catch {
            res.statusCode = 400
            res.end('Invalid request')
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), relayPortPlugin(), e2eRendezvousPlugin()],
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
