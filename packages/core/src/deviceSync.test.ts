import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeviceSync, type ArrayMergeRule } from './deviceSync.js'

/**
 * Importing a snapshot writes over a device the user already had data on, so
 * what matters is what it refuses to touch and what it refuses to lose.
 */

type Item = Record<string, unknown>

const byId: ArrayMergeRule = {
  merge: 'array',
  idOf: item => String(item.id ?? ''),
  revisionOf: item => Number(item.ts ?? 0),
}

const sync = createDeviceSync({
  secretKey: 'app-sync-secret',
  changedEvent: 'app-synced',
  keys: {
    'app-list': byId,
    'app-map': { merge: 'object' },
    'app-theme': { merge: 'copy' },
    'app-rail': { ...byId, preserveOrder: true },
    'app-capped': { ...byId, cap: 2 },
  },
  prefixes: [
    ['app-chat-', {
      merge: 'envelope',
      version: 2,
      maxFields: ['savedAt'],
      lists: { wires: { idOf: byId.idOf, revisionOf: byId.revisionOf } },
    }],
  ],
})

let values: Map<string, string>

function store(): Storage {
  return localStorage
}

beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
})

const snapshotOf = (entries: Record<string, string>) =>
  ({ v: 1, createdAt: 1, values: entries }) as const

describe('createDeviceSync', () => {
  it('reads out only keys a rule names', () => {
    // Closed by design: a key nothing names is not the sync's business, and
    // that has to hold for keys invented after this was written.
    localStorage.setItem('app-list', '[]')
    localStorage.setItem('app-session', 'private')
    localStorage.setItem('app-invented-tomorrow', 'private')
    localStorage.setItem('unrelated', 'private')

    const snapshot = sync.snapshot()
    expect(Object.keys(snapshot.values)).toEqual(['app-list'])
  })

  it('writes in only keys a rule names, whatever the sender claimed', () => {
    // The sending device's idea of what may be synced is not something this
    // one gets to trust.
    sync.import(snapshotOf({ 'app-session': 'stolen', 'app-list': '[]' }), 'user-1')
    expect(localStorage.getItem('app-session')).toBeNull()
    expect(localStorage.getItem('app-list')).toBe('[]')
  })

  it('keeps records from both devices', () => {
    localStorage.setItem('app-list', '[{"id":"a","ts":1}]')
    expect(sync.import(snapshotOf({ 'app-list': '[{"id":"b","ts":2}]' }), 'user-1')).toBe(1)
    const merged = JSON.parse(localStorage.getItem('app-list')!) as Item[]
    expect(merged.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('keeps the newer of two versions of the same record', () => {
    localStorage.setItem('app-list', '[{"id":"a","ts":5,"text":"local"}]')
    sync.import(snapshotOf({ 'app-list': '[{"id":"a","ts":1,"text":"stale"}]' }), 'user-1')
    expect(localStorage.getItem('app-list')).toContain('local')
  })

  it('leaves a list alone when the incoming value is not one', () => {
    // Corrupt or half-written input must not cost the user their data.
    localStorage.setItem('app-list', '[{"id":"a","ts":1}]')
    sync.import(snapshotOf({ 'app-list': 'not json' }), 'user-1')
    expect(localStorage.getItem('app-list')).toBe('[{"id":"a","ts":1}]')
  })

  it('preserves local order where order is the user’s', () => {
    // A workspace rail must not rearrange itself because another device
    // opened things in a different sequence.
    localStorage.setItem('app-rail', '[{"id":"alpha","ts":10},{"id":"beta","ts":20}]')
    sync.import(snapshotOf({ 'app-rail': '[{"id":"beta","ts":40},{"id":"gamma","ts":30}]' }), 'user-1')
    const merged = JSON.parse(localStorage.getItem('app-rail')!) as Item[]
    expect(merged.map(item => item.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('caps a merged list from the oldest end', () => {
    localStorage.setItem('app-capped', '[{"id":"a","ts":1},{"id":"b","ts":2}]')
    sync.import(snapshotOf({ 'app-capped': '[{"id":"c","ts":3}]' }), 'user-1')
    const merged = JSON.parse(localStorage.getItem('app-capped')!) as Item[]
    expect(merged.map(item => item.id)).toEqual(['b', 'c'])
  })

  it('merges maps field by field', () => {
    localStorage.setItem('app-map', '{"mine":"kept","both":"local"}')
    sync.import(snapshotOf({ 'app-map': '{"theirs":"added","both":"remote"}' }), 'user-1')
    expect(JSON.parse(localStorage.getItem('app-map')!)).toEqual({
      mine: 'kept', theirs: 'added', both: 'remote',
    })
  })

  it('leaves a choice this device already made', () => {
    localStorage.setItem('app-theme', 'dark')
    expect(sync.import(snapshotOf({ 'app-theme': 'light' }), 'user-1')).toBe(0)
    expect(localStorage.getItem('app-theme')).toBe('dark')
  })

  it('takes anything this device has no value for', () => {
    expect(sync.import(snapshotOf({ 'app-theme': 'light' }), 'user-1')).toBe(1)
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('merges the lists inside an envelope and keeps the later stamp', () => {
    localStorage.setItem('app-chat-1', '{"v":2,"savedAt":1,"wires":[{"id":"a","ts":1}]}')
    sync.import(snapshotOf({
      'app-chat-1': '{"v":2,"savedAt":9,"wires":[{"id":"b","ts":2}]}',
    }), 'user-1')
    const merged = JSON.parse(localStorage.getItem('app-chat-1')!) as {
      savedAt: number; wires: Item[]
    }
    expect(merged.savedAt).toBe(9)
    expect(merged.wires.map(wire => wire.id)).toEqual(['a', 'b'])
  })

  it('leaves an envelope alone when neither side has the list it expects', () => {
    localStorage.setItem('app-chat-1', '{"v":2,"savedAt":1,"wires":[{"id":"a","ts":1}]}')
    sync.import(snapshotOf({ 'app-chat-1': '{"v":2,"savedAt":9}' }), 'user-1')
    expect(localStorage.getItem('app-chat-1')).toContain('"id":"a"')
  })

  it('reports only the keys it actually changed', () => {
    localStorage.setItem('app-list', '[{"id":"a","ts":1}]')
    expect(sync.import(snapshotOf({ 'app-list': '[{"id":"a","ts":1}]' }), 'user-1')).toBe(0)
  })

  it('refuses a snapshot that is not one', () => {
    expect(sync.import({ v: 2 } as never, 'user-1')).toBe(0)
    expect(sync.import({ v: 1, createdAt: 1 } as never, 'user-1')).toBe(0)
  })

  it('stops reading once the snapshot would get too large', () => {
    const bounded = createDeviceSync({
      secretKey: 'app-sync-secret',
      keys: { 'app-theme': { merge: 'copy' }, 'app-list': byId },
      maxBytes: 20,
    })
    localStorage.setItem('app-theme', 'dark')
    localStorage.setItem('app-list', JSON.stringify(Array(200).fill({ id: 'x', ts: 1 })))
    // Skipped, not aborted: one oversized key should not cost every key
    // that happens to sort after it.
    expect(Object.keys(bounded.snapshot(undefined, store()))).toContain('values')
    expect(bounded.snapshot(undefined, store()).values['app-theme']).toBe('dark')
    expect(bounded.snapshot(undefined, store()).values['app-list']).toBeUndefined()
  })

  it('announces a completed import, and stays quiet when nothing changed', () => {
    const listener = vi.fn()
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: listener })
    sync.import(snapshotOf({ 'app-theme': 'light' }), 'user-1')
    expect(listener).toHaveBeenCalledTimes(1)
    listener.mockClear()
    sync.import(snapshotOf({ 'app-theme': 'other' }), 'user-1')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('the account sync secret', () => {
  it('mints one once and returns it thereafter', () => {
    const first = sync.ensureSecret('user-1')
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(sync.ensureSecret('user-1')).toBe(first)
  })

  it('does not hand one account another account’s secret', () => {
    sync.ensureSecret('user-1')
    expect(sync.loadSecret('user-2')).toBeNull()
  })

  it('ignores a malformed secret rather than adopting it', () => {
    sync.import({ ...snapshotOf({}), accountSyncSecret: 'nonsense' }, 'user-1')
    expect(sync.loadSecret('user-1')).toBeNull()
  })

  it('adopts a well-formed secret from the paired device', () => {
    const secret = 'a'.repeat(32)
    sync.import({ ...snapshotOf({}), accountSyncSecret: secret }, 'user-1')
    expect(sync.loadSecret('user-1')).toBe(secret)
  })
})
