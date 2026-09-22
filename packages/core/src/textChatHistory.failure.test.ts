// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createTextChatHistoryStore } from '@peerly/core'
it('failed history writes report failure, remain readable, and can be retried', () => {
  const store = createTextChatHistoryStore({ storagePrefix: 'review-' })
  const wire = { id: 'message', ts: Date.now(), text: 'unsaved received message', name: 'Friend', deviceKeyId: 'device', sig: 'signature' }
  const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  expect(store.save('room', [wire as any])).toBe(false)
  expect(store.load('room').wires).toEqual([wire])
  fail.mockRestore()
  expect(store.save('room', store.load('room').wires)).toBe(true)
  expect(JSON.parse(localStorage.getItem('review-room')!).wires).toEqual([wire])
})
