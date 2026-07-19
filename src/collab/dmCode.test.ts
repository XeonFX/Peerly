import { describe, expect, it } from 'vitest'
import { dmRoomCode, PEERLY_DM_SCHEME } from './dmCode'
import { dmRoomCode as coreDmRoomCode } from '@peerly/core'

describe('peerly dmRoomCode wrapper', () => {
  it('matches core with the Peerly scheme', async () => {
    const wrapped = await dmRoomCode('user-a', 'user-b')
    const core = await coreDmRoomCode('user-a', 'user-b', PEERLY_DM_SCHEME)
    expect(wrapped).toBe(core)
  })

  it('stays commutative', async () => {
    expect(await dmRoomCode('a', 'b')).toBe(await dmRoomCode('b', 'a'))
  })
})
