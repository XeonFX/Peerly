import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAvatarService } from './avatarService.js'
import type { AvatarStore } from './avatarStore.js'

/**
 * The service's job is to make sure nothing reaches storage — or the network —
 * that the app did not intend. The image re-encoding itself is avatarImage's.
 */

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

function memoryStore(): AvatarStore & { blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>()
  return {
    blobs,
    save: async (id, blob) => { blobs.set(id, blob) },
    load: async id => blobs.get(id) ?? null,
    remove: async id => { blobs.delete(id) },
    loadDataUrl: async id => (blobs.has(id) ? PNG_DATA_URL : null),
  }
}

describe('createAvatarService', () => {
  let store: ReturnType<typeof memoryStore>

  beforeEach(() => {
    store = memoryStore()
    vi.unstubAllGlobals()
  })

  it('reads back a stored avatar and nothing else', async () => {
    const service = createAvatarService(store)
    store.blobs.set('known', new Blob([]))
    expect(await service.preview('known')).toBe(PNG_DATA_URL)
    expect(await service.preview('missing')).toBeUndefined()
    expect(await service.preview(undefined)).toBeUndefined()
  })

  it('refuses to import from an untrusted host, without fetching', async () => {
    // The throw has to come first: reaching the host at all is the leak.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(createAvatarService(store).importFromUrl('https://evil.test/a.png'))
      .rejects.toThrow(/trusted provider/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends no referrer when importing a provider photo', async () => {
    // Otherwise the provider learns which of its images we fetched, for whom.
    const fetchSpy = vi.fn(async () => new Response(new Blob([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    // Re-encoding then fails for want of a canvas, which is fine: the fetch
    // options are what this is about.
    await createAvatarService(store)
      .importFromUrl('https://lh3.googleusercontent.com/a/photo')
      .catch(() => {})
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ referrerPolicy: 'no-referrer' })
  })

  it('reports a failed import rather than storing nothing quietly', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    await expect(
      createAvatarService(store).importFromUrl('https://lh3.googleusercontent.com/a/photo')
    ).rejects.toThrow(/HTTP 404/)
    expect(store.blobs.size).toBe(0)
  })

  it('refuses to adopt anything that is not an inline image', async () => {
    // This fetches whatever it is handed; an https URL would reach its host.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(createAvatarService(store).adoptDataUrl('https://evil.test/a.png'))
      .rejects.toThrow(/inline image/)
    await expect(createAvatarService(store).adoptDataUrl('data:image/svg+xml,<svg/>'))
      .rejects.toThrow(/inline image/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('adopts an inline image under a fresh id and drops the one it replaces', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Blob(['x'])))
    store.blobs.set('old', new Blob([]))
    const avatarId = await createAvatarService(store).adoptDataUrl(PNG_DATA_URL, 'old')
    expect(store.blobs.has(avatarId)).toBe(true)
    expect(store.blobs.has('old')).toBe(false)
  })

  it('keeps the new avatar when dropping the old one fails', async () => {
    // The replacement is already stored; losing the caller's new id over
    // failed housekeeping would leave the account pointing at nothing.
    const failing: AvatarStore = { ...store, remove: async () => { throw new Error('quota') } }
    vi.stubGlobal('fetch', async () => new Response(new Blob(['x'])))
    const avatarId = await createAvatarService(failing).adoptDataUrl(PNG_DATA_URL, 'old')
    expect(avatarId).toBeTruthy()
    expect(store.blobs.has(avatarId)).toBe(true)
  })
})
