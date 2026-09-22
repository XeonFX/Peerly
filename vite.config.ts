import { readFileSync, existsSync } from 'fs'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
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
      // Only the local fake-issuer harness uses this issuer. Production and
      // the DO suite exercise the authenticated Worker implementation.
      const certificateMac = (body: string) => createHmac('sha256', 'peerly-e2e-presence-only').update(body).digest()
      server.middlewares.use('/api/rendezvous/presence', (req, res) => {
        try {
          const token = req.headers.authorization?.slice(7) ?? ''
          const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
          const deviceKeyId = req.headers['x-peerly-device-key']
          if (!deviceKeyId || claims.nonce !== deviceKeyId) throw new Error('wrong device')
          const identity = {
            userId: createHash('sha256').update(`${claims.iss}\n${claims.sub}`).digest().subarray(0, 16).toString('base64url'),
            deviceKeyId,
            rendezvousId: createHmac('sha256', 'peerly-e2e-rendezvous-only').update(claims.email.trim().toLowerCase()).digest('base64url'),
            expiresAt: Date.now() + 300_000,
          }
          const body = Buffer.from(JSON.stringify(identity)).toString('base64url')
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ ...identity, certificate: `${body}.${certificateMac(body).toString('base64url')}` }))
        } catch { res.statusCode = 401; res.end('Unauthorized') }
      })
      server.middlewares.use('/api/rendezvous/verify', (req, res) => {
        let input = ''
        req.on('data', chunk => { input += String(chunk) })
        req.on('end', () => {
          try {
            if (input.length > 2048) throw new Error('oversized')
            const [body, signature] = input.split('.')
            if (!timingSafeEqual(Buffer.from(signature, 'base64url'), certificateMac(body))) throw new Error('invalid')
            const identity = JSON.parse(Buffer.from(body, 'base64url').toString())
            if (identity.expiresAt <= Date.now()) throw new Error('expired')
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify(identity))
          } catch { res.statusCode = 401; res.end('Unauthorized') }
        })
      })
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
