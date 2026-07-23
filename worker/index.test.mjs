import { describe, expect, it } from 'vitest'
import worker, { allowedAuthParent } from './index.mjs'

describe('Peerly auth bridge parent validation', () => {
  it('accepts production and exact HTTPS Peerly branch preview origins', () => {
    expect(allowedAuthParent('https://peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://preview.peerly.cc')).toBe(true)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev')).toBe(true)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.worker.dev')).toBe(true)
    expect(allowedAuthParent('http://fix-auth-peerly.codefusion.workers.dev')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev/path')).toBe(false)
    expect(allowedAuthParent('https://fix-auth-peerly.codefusion.workers.dev.evil.test')).toBe(false)
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
