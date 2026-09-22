import { describe, expect, it, vi } from 'vitest'
import { createDeviceRevocationQueue } from './deviceRevocationQueue'

describe('pending device revocations', () => {
  const storage = () => {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } }
  }
  it('survives a failed request and reload, and clears only after server acknowledgement', async () => {
    const disk = storage(), queue = createDeviceRevocationQueue(disk)
    queue.enqueue('alice', 'issuer', { deviceKeyId: 'lost-device', label: 'Phone' })
    await expect(queue.flush('alice', 'issuer', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    const reloaded = createDeviceRevocationQueue(disk)
    expect(reloaded.read('alice', 'issuer')).toHaveLength(1)
    expect(reloaded.read('bob', 'issuer')).toHaveLength(0)
    expect(reloaded.read('alice', 'other-device')).toHaveLength(0)
    const revoke = vi.fn(async () => {})
    await reloaded.flush('alice', 'issuer', revoke)
    expect(revoke).toHaveBeenCalledWith('lost-device')
    expect(reloaded.read('alice', 'issuer')).toHaveLength(0)
  })
  it('stops when the signed-in account changes', async () => {
    const queue = createDeviceRevocationQueue(storage())
    queue.enqueue('alice', 'issuer', { deviceKeyId: 'phone', label: 'Phone' })
    const revoke = vi.fn(async () => {})
    await queue.flush('alice', 'issuer', revoke, () => false)
    expect(revoke).not.toHaveBeenCalled()
    expect(queue.read('alice', 'issuer')).toHaveLength(1)
  })
})
