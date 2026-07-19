import { describe, expect, it } from 'vitest'
import { dmRoomCode } from './dmCode'

describe('dmRoomCode', () => {
  it('is commutative for the same pair', async () => {
    const ab = await dmRoomCode('user-a', 'user-b')
    const ba = await dmRoomCode('user-b', 'user-a')
    expect(ab).toBe(ba)
    expect(ab).toMatch(/^[0-9a-f]{32}$/)
  })

  it('differs for different partners', async () => {
    const ab = await dmRoomCode('user-a', 'user-b')
    const ac = await dmRoomCode('user-a', 'user-c')
    expect(ab).not.toBe(ac)
  })

  it('rejects identical ids', async () => {
    await expect(dmRoomCode('me', 'me')).rejects.toThrow()
  })
})
