import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFriendsStore } from './friendsStore.js'
import type { DeviceSigner } from './textChatSigning.js'

/**
 * The unified friends store. The two app copies agreed on the mechanism and
 * disagreed on the guards; these pin the reconciliation.
 */

const config = {
  scheme: 'test-friend-v1',
  storageKey: 'test-friends',
  subscriptionsKey: 'test-friends-subs',
  credentialsKey: 'test-dm-credentials',
}

const OWNER = 'owner-user'
const SECRET = 'a'.repeat(32)

/** The suite runs in Node, so browser storage is stubbed in memory. */
function stubLocalStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  })
}

describe('createFriendsStore', () => {
  let store: ReturnType<typeof createFriendsStore>

  /** Signing is covered by peopleList's own tests; what matters here is the
   *  store's guards, so a deterministic stand-in keeps the suite in Node. */
  const signer: DeviceSigner = {
    publicKeyId: async () => 'P-256:test-x:test-y',
    sign: async () => 'test-signature',
  }

  beforeEach(() => {
    stubLocalStorage()
    store = createFriendsStore(config)
  })

  it('adds a friend and finds them on the list', async () => {
    const list = store.empty()
    const entry = await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-1', subjectName: 'Ada',
    })
    expect(entry).not.toBeNull()
    expect(store.has(list, 'friend-1')).toBe(true)
    expect(store.list(list).map(item => item.subjectName)).toEqual(['Ada'])
  })

  it('refuses to befriend the owner', async () => {
    // One copy checked this and the other did not, so one app let you add
    // yourself as a friend.
    const list = store.empty()
    expect(await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: OWNER, subjectName: 'Me',
    })).toBeNull()
    expect(store.list(list)).toHaveLength(0)
  })

  it('refuses an entry with no subject', async () => {
    const list = store.empty()
    expect(await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: '', subjectName: 'Nobody',
    })).toBeNull()
  })

  it('falls back to the id when a peer sent no display name', async () => {
    const list = store.empty()
    const entry = await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-2', subjectName: '',
    })
    expect(entry?.subjectName).toBe('friend-2')
  })

  it('records app-specific fields without core knowing what they mean', async () => {
    // One app captures a verified email so a workspace invite needs no
    // retyping; the other is deliberately userId-only. Core stays neutral.
    const list = store.empty()
    const entry = await store.add(list, signer, {
      ownerUserId: OWNER,
      subjectUserId: 'friend-3',
      subjectName: 'Grace',
      extraFields: { subjectEmail: 'grace@example.test' },
    })
    expect((entry as unknown as { subjectEmail: string }).subjectEmail).toBe('grace@example.test')
  })

  it('stores DM credentials only when both halves are present', async () => {
    const list = store.empty()
    await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-4', subjectName: 'A', dmSecret: SECRET,
    })
    expect(store.dmSecretFor(list, 'friend-4')).toBeUndefined()

    await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-5', subjectName: 'B',
      dmSecret: SECRET, subjectDeviceKeyId: 'device-b',
    })
    expect(store.dmSecretFor(list, 'friend-5')).toBe(SECRET)
    expect(store.deviceKeyFor(list, 'friend-5')).toBe('device-b')
  })

  it('never returns a credential for someone not on the list', async () => {
    // A credential must not outlive the friendship that justified it.
    const list = store.empty()
    await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-6', subjectName: 'C',
      dmSecret: SECRET, subjectDeviceKeyId: 'device-c',
    })
    expect(store.dmSecretFor(list, 'friend-6')).toBe(SECRET)
    store.remove(list, 'friend-6')
    expect(store.dmSecretFor(list, 'friend-6')).toBeUndefined()
    expect(store.deviceKeyFor(list, 'friend-6')).toBeUndefined()
  })

  it('reports whether a removal changed anything', async () => {
    const list = store.empty()
    await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-7', subjectName: 'D',
    })
    expect(store.remove(list, 'friend-7')).toBe(true)
    expect(store.remove(list, 'friend-7')).toBe(false)
  })

  it('round-trips through storage', async () => {
    const list = store.empty()
    await store.add(list, signer, {
      ownerUserId: OWNER, subjectUserId: 'friend-8', subjectName: 'E',
    })
    expect(store.has(store.load(), 'friend-8')).toBe(true)
  })

  it('treats an absent user id as not listed', () => {
    expect(store.has(store.empty(), undefined)).toBe(false)
  })
})
