import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvStore } from '../utils/kvStore'
import { DeviceIdentity } from '../collab/deviceIdentity'
import { signAllowList } from '../collab/allowList'
import type { StoredWorkspace } from '../collab/workspaceStore'
import {
  applyWorkspaceBackup,
  backupFileName,
  buildWorkspaceBackup,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from './workspaceBackup'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
    clear: () => store.clear(),
    key: index => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

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

async function makeWorkspace(): Promise<StoredWorkspace> {
  const creator = new DeviceIdentity(memoryStore())
  return {
    workspaceId: 'wsbackup01',
    workspaceName: 'Backup Test',
    creatorKeyId: await creator.publicKeyId(),
    allowList: await signAllowList(creator, ['alice@example.com']),
    lastOpenedAt: Date.now(),
  }
}

function storedMessage(id: string, text: string, timestamp: number) {
  return {
    id,
    text,
    senderId: 't1',
    senderName: 'Alice',
    senderColor: '#fff',
    timestamp,
    channelId: 'general',
    type: 'text' as const,
  }
}

describe('workspaceBackup', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })

  it('round-trips: export, wipe, import restores access, channels, messages', async () => {
    const workspace = await makeWorkspace()
    localStorage.setItem(
      'peerly-history-wsbackup01__general',
      JSON.stringify([storedMessage('m1', 'first', 1), storedMessage('m2', 'second', 2)])
    )
    localStorage.setItem(
      'peerly-channels-wsbackup01',
      JSON.stringify([{ id: 'random', name: 'random', kind: 'channel' }])
    )

    const backup = buildWorkspaceBackup(workspace)
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(backup.histories.general).toHaveLength(2)
    expect(backup).not.toHaveProperty('keyBindings')

    localStorage.clear()
    const result = await applyWorkspaceBackup(JSON.parse(JSON.stringify(backup)))

    expect(result.workspaceName).toBe('Backup Test')
    expect(result.importedMessages).toBe(2)
    expect(JSON.parse(localStorage.getItem('peerly-workspaces') ?? '[]')).toHaveLength(1)
    const restored = JSON.parse(localStorage.getItem('peerly-history-wsbackup01__general') ?? '[]')
    expect(restored.map((entry: { text: string }) => entry.text)).toEqual(['first', 'second'])
  })

  it('merges by message id — importing can add, never overwrite', async () => {
    const workspace = await makeWorkspace()
    localStorage.setItem(
      'peerly-history-wsbackup01__general',
      JSON.stringify([storedMessage('m1', 'exported copy', 1)])
    )
    const backup = buildWorkspaceBackup(workspace)

    // Local storage moves on: m1 edited locally? No — same id keeps local copy.
    localStorage.setItem(
      'peerly-history-wsbackup01__general',
      JSON.stringify([storedMessage('m1', 'local copy', 1), storedMessage('m3', 'newer', 3)])
    )
    const result = await applyWorkspaceBackup(JSON.parse(JSON.stringify(backup)))

    expect(result.importedMessages).toBe(0)
    const merged = JSON.parse(localStorage.getItem('peerly-history-wsbackup01__general') ?? '[]')
    expect(merged.map((entry: { text: string }) => entry.text)).toEqual(['local copy', 'newer'])
  })

  it('rejects a backup whose allow-list is not creator-signed', async () => {
    const workspace = await makeWorkspace()
    const backup = buildWorkspaceBackup(workspace)
    const forged = JSON.parse(JSON.stringify(backup))
    forged.workspace.allowList.emails.push('mallory@example.com')

    await expect(applyWorkspaceBackup(forged)).rejects.toThrow(/does not verify/)
    expect(localStorage.getItem('peerly-workspaces')).toBeNull()
  })

  it('rejects a valid backup when the signed-in account is not invited', async () => {
    const workspace = await makeWorkspace()
    const backup = buildWorkspaceBackup(workspace)

    await expect(applyWorkspaceBackup(backup, 'mallory@example.com')).rejects.toThrow(
      /not invited/
    )
    expect(localStorage.getItem('peerly-workspaces')).toBeNull()
  })

  it('rejects non-backup files with a readable error', async () => {
    await expect(applyWorkspaceBackup({ hello: 'world' })).rejects.toThrow(/Not a Peerly/)
    await expect(applyWorkspaceBackup('[]')).rejects.toThrow(/Not a Peerly/)
  })

  it('sanitizes imported entries: clamps text, drops malformed, scrubs thumbnails', async () => {
    const workspace = await makeWorkspace()
    const backup = buildWorkspaceBackup(workspace)
    const doctored = JSON.parse(JSON.stringify(backup))
    doctored.histories = {
      general: [
        { ...storedMessage('big', 'x'.repeat(50_000), 1) },
        { id: 42, text: 'bad id', type: 'text' },
        {
          ...storedMessage('f1', 'file', 2),
          type: 'file',
          fileMeta: {
            id: 'hash',
            name: 'pic.png',
            mimeType: 'image/png',
            size: 10,
            thumbnail: 'javascript:alert(1)',
          },
        },
      ],
    }

    await applyWorkspaceBackup(doctored)
    const restored = JSON.parse(localStorage.getItem('peerly-history-wsbackup01__general') ?? '[]')
    expect(restored).toHaveLength(2)
    expect(restored[0].text.length).toBeLessThanOrEqual(8_000)
    expect(restored[1].fileMeta.thumbnail).toBeUndefined()
  })

  it('drops bad signatures and never trusts imported key-to-user bindings', async () => {
    const workspace = await makeWorkspace()
    const backup = buildWorkspaceBackup(workspace)
    const doctored = JSON.parse(JSON.stringify(backup))
    doctored.keyBindings = { 'P-256:attacker:key': 'user-alice' }
    doctored.histories = {
      general: [
        { ...storedMessage('legacy', 'unsigned but readable', 1), senderUserId: 'user-alice' },
        {
          ...storedMessage('forged', 'bad signature', 2),
          senderUserId: 'user-alice',
          senderDeviceKeyId: 'P-256:not-a-real:key',
          signature: 'forged',
        },
      ],
    }

    const result = await applyWorkspaceBackup(doctored)
    const restored = JSON.parse(localStorage.getItem('peerly-history-wsbackup01__general') ?? '[]')

    expect(result.importedMessages).toBe(1)
    expect(restored).toHaveLength(1)
    expect(restored[0].text).toBe('unsigned but readable')
    expect(restored[0].senderUserId).toBeUndefined()
    expect(localStorage.getItem('peerly-key-bindings:wsbackup01')).toBeNull()
  })

  it('names files after the workspace and date', () => {
    expect(backupFileName('My Team!', new Date('2026-07-16T12:00:00Z'))).toBe(
      'peerly-my-team-2026-07-16.json'
    )
  })
})
