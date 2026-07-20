import { describe, expect, it } from 'vitest'
import { dmRoomCode } from './dmRoomCode.js'

describe('dmRoomCode', () => {
  const secret = '0123456789abcdef0123456789abcdef'
  it('is commutative for the same pair and scheme', async () => {
    const ab = await dmRoomCode('user-a', 'user-b', 'app-dm-v1', secret)
    const ba = await dmRoomCode('user-b', 'user-a', 'app-dm-v1', secret)
    expect(ab).toBe(ba)
    expect(ab).toMatch(/^[0-9a-f]{32}$/)
  })

  it('differs for different partners or schemes', async () => {
    const ab = await dmRoomCode('user-a', 'user-b', 'app-dm-v1', secret)
    const ac = await dmRoomCode('user-a', 'user-c', 'app-dm-v1', secret)
    const abOther = await dmRoomCode('user-a', 'user-b', 'other-dm-v1', secret)
    expect(ab).not.toBe(ac)
    expect(ab).not.toBe(abOther)
  })

  it('rejects identical ids or empty scheme', async () => {
    await expect(dmRoomCode('me', 'me', 'app-dm-v1', secret)).rejects.toThrow()
    await expect(dmRoomCode('a', 'b', '', secret)).rejects.toThrow()
    await expect(dmRoomCode('a', 'b', 'app-dm-v1', '')).rejects.toThrow()
  })
})
