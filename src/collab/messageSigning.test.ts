import { describe, expect, it, vi } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from './deviceIdentity'
import type { HistoryEntry } from '../protocol/types'
import { sanitizeHistoryEntries, signedMessageBytes, verifyHistoryEntry } from './messageSigning'
import { loadKeyBindings, rememberKeyBinding } from './keyBindings'

function memoryStore(): KvStore<CryptoKeyPair> {
  const map = new Map<string, CryptoKeyPair>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

async function signedEntry(
  identity: DeviceIdentity,
  overrides: Partial<HistoryEntry> = {}
): Promise<HistoryEntry> {
  const deviceKeyId = await identity.publicKeyId()
  const entry: HistoryEntry = {
    id: 'm1',
    text: 'hello',
    senderId: 'transport-1',
    senderUserId: 'user-alice',
    senderName: 'Alice',
    senderColor: '#fff',
    timestamp: 1234,
    channelId: 'general',
    type: 'text',
    senderDeviceKeyId: deviceKeyId,
    ...overrides,
  }
  entry.signature = await identity.sign(
    signedMessageBytes({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      fileMeta: entry.fileMeta,
      senderUserId: entry.senderUserId,
      senderDeviceKeyId: deviceKeyId,
      timestamp: entry.timestamp,
      channelId: entry.channelId,
      editedAt: entry.editedAt,
      deletedAt: entry.deletedAt,
    })
  )
  return entry
}

describe('messageSigning', () => {
  it('round-trips: a signed entry verifies', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const entry = await signedEntry(identity)
    expect(await verifyHistoryEntry(entry)).toBe('valid')
  })

  it('any altered field invalidates the signature', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const entry = await signedEntry(identity)
    expect(await verifyHistoryEntry({ ...entry, text: 'forged text' })).toBe('invalid')
    expect(await verifyHistoryEntry({ ...entry, senderUserId: 'user-mallory' })).toBe('invalid')
    expect(await verifyHistoryEntry({ ...entry, timestamp: 9999 })).toBe('invalid')
    expect(await verifyHistoryEntry({ ...entry, channelId: 'other' })).toBe('invalid')
  })

  it('makes edited and deleted revisions tamper-evident', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const edited = await signedEntry(identity, { text: 'edited', editedAt: 2000 })
    expect(await verifyHistoryEntry(edited)).toBe('valid')
    expect(await verifyHistoryEntry({ ...edited, editedAt: 2001 })).toBe('invalid')

    const deleted = await signedEntry(identity, { text: '', deletedAt: 3000 })
    expect(await verifyHistoryEntry(deleted)).toBe('valid')
    expect(await verifyHistoryEntry({ ...deleted, deletedAt: undefined })).toBe('invalid')
  })

  it('drops forged entries, keeps text of unsigned ones without identity', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const good = await signedEntry(identity)
    const forged = { ...(await signedEntry(identity)), id: 'm2', text: 'tampered' }
    const unsigned: HistoryEntry = {
      id: 'm3',
      text: 'legacy',
      senderId: 't3',
      senderUserId: 'user-claimed',
      senderName: 'Claimed',
      senderColor: '#000',
      timestamp: 5,
      channelId: 'general',
      type: 'text',
    }

    const keyId = await identity.publicKeyId()
    const result = await sanitizeHistoryEntries([good, forged, unsigned], deviceKeyId =>
      deviceKeyId === keyId ? 'user-alice' : undefined
    )

    expect(result.map(e => e.id)).toEqual(['m1', 'm3'])
    expect(result[0].senderUserId).toBe('user-alice')
    expect(result[1].senderUserId).toBeUndefined()
  })

  it('strips the identity claim when the signing key is not bound to it', async () => {
    // Mallory signs with her own real key but claims Alice's durable id.
    const mallory = new DeviceIdentity(memoryStore())
    const entry = await signedEntry(mallory, { senderUserId: 'user-alice' })
    const malloryKey = await mallory.publicKeyId()

    const result = await sanitizeHistoryEntries([entry], deviceKeyId =>
      deviceKeyId === malloryKey ? 'user-mallory' : undefined
    )

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('hello')
    expect(result[0].senderUserId).toBeUndefined()
  })

  it('keeps signed file-entry names tamper-evident', async () => {
    const identity = new DeviceIdentity(memoryStore())
    const entry = await signedEntry(identity, {
      type: 'file',
      fileMeta: { id: 'hash1', name: 'invoice.pdf', mimeType: 'application/pdf', size: 100 },
    })
    expect(await verifyHistoryEntry(entry)).toBe('valid')
    expect(
      await verifyHistoryEntry({
        ...entry,
        fileMeta: { ...entry.fileMeta!, name: 'malware.exe' },
      })
    ).toBe('invalid')
  })
})

describe('keyBindings', () => {
  it('persists and reloads bindings per workspace', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    })

    rememberKeyBinding('ws1', 'P-256:a:b', 'user-1')
    rememberKeyBinding('ws2', 'P-256:c:d', 'user-2')
    expect(loadKeyBindings('ws1')).toEqual({ 'P-256:a:b': 'user-1' })
    expect(loadKeyBindings('ws2')).toEqual({ 'P-256:c:d': 'user-2' })
    expect(loadKeyBindings('ws3')).toEqual({})
  })
})
