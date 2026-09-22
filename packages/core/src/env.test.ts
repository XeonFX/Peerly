import { describe, expect, it } from 'vitest'
import { requireAppId } from './env'

describe('requireAppId', () => {
  it('returns the host-provided application id', () => {
    expect(requireAppId({ VITE_APP_ID: 'app-a' })).toBe('app-a')
  })

  it.each([
    {},
    { VITE_APP_ID: '' },
    { VITE_APP_ID: 'App A' },
    { VITE_APP_ID: '../app-a' },
  ])('rejects a missing or unsafe application id', env => {
    expect(() => requireAppId(env)).toThrow('VITE_APP_ID is required')
  })
})
