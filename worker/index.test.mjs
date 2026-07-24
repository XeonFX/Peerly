import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import worker, { allowedAuthParent } from './index.mjs'

// wrangler.preview.jsonc allows `//` line comments; strip them before
// JSON.parse. Scans char-by-char tracking string/escape state so a `//`
// inside a quoted value (e.g. a URL) is never mistaken for a comment — a
// regex-based line-suffix strip can't make that distinction reliably.
function parseJsonc(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    out += char
  }
  return JSON.parse(out)
}

const previewConfig = parseJsonc(
  readFileSync(new URL('../wrangler.preview.jsonc', import.meta.url), 'utf8')
)

describe('Peerly auth bridge parent validation', () => {
  it('accepts production and exact HTTPS Peerly branch preview origins', () => {
    expect(allowedAuthParent('https://peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev')).toBe(true)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.worker.dev')).toBe(true)
    expect(allowedAuthParent('http://fix-auth-peerly.codefusion.workers.dev')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev/path')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev.evil.test')).toBe(false)
    // Both staging shapes on our own zone: `<label>.preview` and
    // `<label>-preview`. Only the first was accepted before, so a worker at
    // dev-preview.peerly.cc had every /api/network/* request 403'd.
    expect(allowedAuthParent('https://branch.preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://dev-preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://dev-preview.peerly.cc.evil.test')).toBe(false)
    expect(allowedAuthParent('https://evil.dev-preview.peerly.cc')).toBe(false)
  })

  it('enforces the parent allowlist before serving the bridge', async () => {
    const params = new URLSearchParams({
      parent_origin: 'https://evil.test',
      client_id: 'client.apps.googleusercontent.com',
      nonce: 'device-key',
      state: 'request-state',
    })
    const response = await worker.fetch(
      new Request(`https://auth.example.test/api/auth/google/bridge?${params}`),
      { VITE_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com' },
      {}
    )
    expect(response.status).toBe(400)
  })
})

describe('Peerly preview network configuration', () => {
  it('builds the client against Durable Objects without the VPS relay', () => {
    expect(previewConfig.build?.command).toContain('VITE_APP_ID=peerly')
    expect(previewConfig.build?.command).toContain('VITE_SIGNALING=durable-objects')
    expect(previewConfig.build?.command).toContain(
      'VITE_TURN_URLS=turn:turn.peerly.cc:3478,turns:turn.peerly.cc:5349'
    )
    expect(previewConfig.build?.command).not.toContain('VITE_RELAY_HOST')
    expect(previewConfig.build?.command).not.toContain('relay.peerly.cc')
    expect(previewConfig.build?.command).not.toContain('ws-relay')
  })

  it('configures credential and rendezvous services without storing secrets in source', () => {
    expect(previewConfig.vars.APP_ID).toBe('peerly')
    expect(previewConfig.vars.TURN_URLS).toBe(
      'turn:turn.peerly.cc:3478,turns:turn.peerly.cc:5349'
    )
    expect(previewConfig.secrets?.required).toEqual([
      'TURN_AUTH_SECRET',
      'RENDEZVOUS_SECRET',
      'NETWORK_SESSION_SECRET',
      'OPAQUE_USER_ID_SECRET',
    ])
    expect(previewConfig.vars).not.toHaveProperty('RELAY_TICKET_SECRET')
    expect(previewConfig.vars).not.toHaveProperty('TURN_AUTH_SECRET')
    expect(previewConfig.vars).not.toHaveProperty('RENDEZVOUS_SECRET')
  })
})
