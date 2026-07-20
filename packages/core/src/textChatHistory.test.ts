import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTextChatHistoryStore,
  mergeTextChatWires,
} from './textChatHistory.js'
import type { TextChatWire } from './textChatSigning.js'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const wire = (id: string, ts: number, text = 'hi', extra: Partial<TextChatWire> = {}): TextChatWire => ({
  id,
  ts,
  text,
  name: 'Ada',
  deviceKeyId: 'P-256:x:y',
  sig: 'sig',
  ...extra,
})

describe('mergeTextChatWires', () => {
  it('prefers higher revision over older text', () => {
    const a = [wire('1', 1, 'old', { editedAt: 1 })]
    const b = [wire('1', 1, 'new', { editedAt: 5 })]
    expect(mergeTextChatWires(a, b)[0]?.text).toBe('new')
  })
})

describe('createTextChatHistoryStore', () => {
  const hist = createTextChatHistoryStore({
    storagePrefix: 'test-hist-',
    messageCap: 3,
  })

  it('dual-reads legacy bare arrays and rewrites v2', () => {
    store.set('test-hist-room1', JSON.stringify([wire('1', 1), wire('2', 2)]))
    const loaded = hist.load('room1')
    expect(loaded.wires).toHaveLength(2)
    hist.save('room1', loaded.wires, loaded.reactions)
    const raw = JSON.parse(store.get('test-hist-room1')!)
    expect(raw.v).toBe(2)
    expect(raw.wires).toHaveLength(2)
  })

  it('caps messages', () => {
    const wires = [1, 2, 3, 4, 5].map(n => wire(String(n), n))
    hist.save('r', wires)
    expect(hist.load('r').wires).toHaveLength(3)
    expect(hist.load('r').wires.map(w => w.id)).toEqual(['3', '4', '5'])
  })

  it('bounds untrusted envelopes before returning them', () => {
    const many = Array.from({ length: 20 }, (_, index) => wire(String(index), index))
    expect(hist.parseEnvelope({ messages: many, reactions: [] }).messages).toHaveLength(3)
  })

  it('rejects non-finite timestamps and oversized fields', () => {
    expect(hist.parseEnvelope({
      messages: [wire('bad', Number.POSITIVE_INFINITY), wire('huge', 1, 'x'.repeat(4_001))],
      reactions: [],
    }).messages).toEqual([])
  })
})
