import { describe, expect, it } from 'vitest'
import { dmRoomCode, PEERLY_DM_SCHEME } from './dmCode'
import { dmRoomCode as coreDmRoomCode } from '@peerly/core'

describe('peerly dmRoomCode wrapper', () => {
  const secret = '0123456789abcdef0123456789abcdef'
  it('matches core with the Peerly scheme', async () => {
    const wrapped = await dmRoomCode('user-a', 'user-b', secret)
    const core = await coreDmRoomCode('user-a', 'user-b', PEERLY_DM_SCHEME, secret)
    expect(wrapped).toBe(core)
  })

  it('stays commutative', async () => {
    expect(await dmRoomCode('a', 'b', secret)).toBe(await dmRoomCode('b', 'a', secret))
  })
})
