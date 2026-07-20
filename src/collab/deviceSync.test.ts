import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeviceSyncSnapshot, importDeviceSyncSnapshot } from './deviceSync'

let values: Map<string, string>

beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  })
})

describe('device sync', () => {
  it('excludes account sessions and unrelated browser data', () => {
    localStorage.setItem('peerly-workspaces', '[{"workspaceId":"a","lastOpenedAt":1}]')
    localStorage.setItem('peerly-session', 'private')
    localStorage.setItem('unrelated', 'private')
    const snapshot = createDeviceSyncSnapshot()
    expect(snapshot.values['peerly-workspaces']).toContain('workspaceId')
    expect(snapshot.values['peerly-session']).toBeUndefined()
    expect(snapshot.values.unrelated).toBeUndefined()
  })

  it('merges workspace and DM histories without losing either device', () => {
    localStorage.setItem('peerly-history-ws-general', '[{"id":"a","timestamp":1}]')
    localStorage.setItem('peerly-gdm-hist-v1-room', '{"v":2,"savedAt":1,"wires":[{"id":"a","ts":1}],"reactions":[]}')
    const imported = importDeviceSyncSnapshot({
      v: 1,
      createdAt: 2,
      values: {
        'peerly-history-ws-general': '[{"id":"b","timestamp":2}]',
        'peerly-gdm-hist-v1-room': '{"v":2,"savedAt":2,"wires":[{"id":"b","ts":2}],"reactions":[]}',
      },
    }, 'user-1')
    expect(imported).toBe(2)
    expect(localStorage.getItem('peerly-history-ws-general')).toContain('"id":"a"')
    expect(localStorage.getItem('peerly-history-ws-general')).toContain('"id":"b"')
    expect(localStorage.getItem('peerly-gdm-hist-v1-room')).toContain('"id":"a"')
    expect(localStorage.getItem('peerly-gdm-hist-v1-room')).toContain('"id":"b"')
  })

  it('preserves the local workspace rail order when newer activity syncs in', () => {
    localStorage.setItem('peerly-workspaces', JSON.stringify([
      { workspaceId: 'alpha', lastOpenedAt: 10 },
      { workspaceId: 'beta', lastOpenedAt: 20 },
    ]))
    importDeviceSyncSnapshot({
      v: 1,
      createdAt: 30,
      values: {
        'peerly-workspaces': JSON.stringify([
          { workspaceId: 'beta', lastOpenedAt: 40 },
          { workspaceId: 'gamma', lastOpenedAt: 30 },
        ]),
      },
    }, 'user-1')

    const merged = JSON.parse(localStorage.getItem('peerly-workspaces') ?? '[]') as Array<{ workspaceId: string }>
    expect(merged.map(workspace => workspace.workspaceId)).toEqual(['alpha', 'beta', 'gamma'])
  })
})
