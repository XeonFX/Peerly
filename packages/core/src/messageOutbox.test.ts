import { expect, it, vi } from 'vitest'
import { createMessageOutbox, type OutboxEntry, type OutboxStorage } from './messageOutbox.js'

function memoryStorage(): OutboxStorage {
  const records = new Map<string, OutboxEntry<unknown>>()
  return {
    async list<T>(scope: string) { return [...records.values()].filter(entry => entry.scope === scope) as OutboxEntry<T>[] },
    async put(entry) { records.set(`${entry.scope}:${entry.id}`, structuredClone(entry)) },
    async remove(scope, id) { records.delete(`${scope}:${id}`) },
  }
}

it('survives lost acknowledgements and reloads without changing message identity', async () => {
  const disk = memoryStorage()
  const first = createMessageOutbox<{ id: string; text: string }>(disk)
  const payload = { id: 'stable-id', text: 'keep this message' }
  await first.enqueue('alice:workspace', payload)
  const accepted = new Map<string, string>()
  await first.flush('alice:workspace', async wire => {
    accepted.set(wire.id, wire.text)
    throw new Error('ACK lost after server commit')
  }, () => true)
  expect((await first.list('alice:workspace'))[0].failed).toBe(true)
  const reloaded = createMessageOutbox<typeof payload>(disk)
  await reloaded.flush('alice:workspace', async wire => { accepted.set(wire.id, wire.text) }, () => true)
  expect(accepted.size).toBe(1)
  expect(accepted.get('stable-id')).toBe(payload.text)
  expect(await reloaded.list('alice:workspace')).toEqual([])
})

it('keeps queued messages scoped and does not drop messages added during delivery', async () => {
  const outbox = createMessageOutbox<{ id: string }>(memoryStorage())
  await outbox.enqueue('alice:workspace', { id: 'z-first' })
  await outbox.enqueue('bob:workspace', { id: 'bob-private' })
  const delivered: string[] = []
  await outbox.flush('alice:workspace', async payload => {
    delivered.push(payload.id)
    if (payload.id === 'z-first') await outbox.enqueue('alice:workspace', { id: 'a-second' })
  }, () => true)
  expect(delivered).toEqual(['z-first', 'a-second'])
  expect(await outbox.list('bob:workspace')).toHaveLength(1)
  const send = vi.fn(async () => {})
  await outbox.flush('bob:workspace', send, () => false)
  expect(send).not.toHaveBeenCalled()
})

it('cancels retry without resurrecting an in-flight failed attempt', async () => {
  const outbox = createMessageOutbox<{ id: string }>(memoryStorage())
  await outbox.enqueue('scope', { id: 'cancel-me' })
  let fail!: () => void
  const blocked = new Promise<void>((_, reject) => { fail = () => reject(new Error('offline')) })
  const send = vi.fn(() => blocked)
  const flush = outbox.flush('scope', send, () => true)
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  await outbox.remove('scope', 'cancel-me')
  fail()
  await flush
  expect(await outbox.list('scope')).toEqual([])
})
