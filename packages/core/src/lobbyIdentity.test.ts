import { afterEach, expect, it, vi } from 'vitest'
import { createLobbyIdentityClient } from './lobbyIdentity.js'
import { configureRuntimeAuthCredentialProvider } from './runtimeCredentials.js'

afterEach(() => {
  configureRuntimeAuthCredentialProvider(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('binds issuance to the current device and caches only until renewal', async () => {
  vi.useFakeTimers()
  const sign = vi.fn(async (_data: Uint8Array) => 'signature')
  configureRuntimeAuthCredentialProvider(() => ({ providerId: 'google', token: 'provider-token',
    signer: { publicKeyId: async () => 'device', sign } }))
  const claims = { userId: 'user', deviceKeyId: 'wrong-device', rendezvousId: 'opaque', expiresAt: Date.now() + 300_000, certificate: 'certificate' }
  const fetchMock = vi.fn(async () => Response.json(claims))
  vi.stubGlobal('fetch', fetchMock)
  const client = createLobbyIdentityClient()
  expect(await client.issue()).toBeNull()
  claims.deviceKeyId = 'device'
  expect(await client.issue()).toEqual(claims)
  expect(await client.issue()).toEqual(claims)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(new TextDecoder().decode(sign.mock.calls[0][0])).toMatch(/^peerly-lobby-identity-v1\ngoogle\ndevice\n/)
  await vi.advanceTimersByTimeAsync(275_000)
  await client.issue()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('coalesces public verification and fails closed after expiry or a bad response', async () => {
  vi.useFakeTimers()
  const claims = { userId: 'user', deviceKeyId: 'device', rendezvousId: 'opaque', expiresAt: Date.now() + 1000 }
  const fetchMock = vi.fn(async () => Response.json(claims))
  vi.stubGlobal('fetch', fetchMock)
  const client = createLobbyIdentityClient()
  expect(await Promise.all([client.verify('certificate'), client.verify('certificate')])).toEqual([claims, claims])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1001)
  expect(await client.verify('certificate')).toBeNull()
  expect(await client.verify('x'.repeat(2049))).toBeNull()
  fetchMock.mockImplementation(async () => new Response('', { status: 401 }))
  expect(await client.verify('tampered')).toBeNull()
})

it('never reuses the previous account certificate while concurrent renewal is pending', async () => {
  let token = 'account-a'
  configureRuntimeAuthCredentialProvider(() => ({ providerId: 'google', token,
    signer: { publicKeyId: async () => 'device', sign: async () => 'signature' } }))
  const claims = (userId: string) => ({ userId, deviceKeyId: 'device', rendezvousId: 'opaque', expiresAt: Date.now() + 300_000, certificate: userId })
  let finish!: (response: Response) => void
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(claims('account-a')))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  const client = createLobbyIdentityClient()
  expect((await client.issue())?.userId).toBe('account-a')
  token = 'account-b'
  const pending = client.issue()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const concurrent = client.issue()
  // Let the second call read the same in-flight credential before resolving it.
  await Promise.resolve()
  await Promise.resolve()
  finish(Response.json(claims('account-b')))
  expect((await pending)?.userId).toBe('account-b')
  expect((await concurrent)?.userId).toBe('account-b')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
