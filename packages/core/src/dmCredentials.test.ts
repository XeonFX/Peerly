import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDmCredentialStore } from './dmCredentials.js'

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  })
})

describe('createDmCredentialStore', () => {
  it('stores credentials separately and rejects malformed secrets', () => {
    const store = createDmCredentialStore('dm-test')
    store.set('friend', { secret: 'bad', deviceKeyId: 'key' })
    expect(store.get('friend')).toBeUndefined()
    store.set('friend', {
      secret: '0123456789abcdef0123456789abcdef',
      deviceKeyId: 'P-256:key',
    })
    expect(store.get('friend')).toEqual({
      secret: '0123456789abcdef0123456789abcdef',
      deviceKeyId: 'P-256:key',
    })
    store.remove('friend')
    expect(store.get('friend')).toBeUndefined()
  })
})
