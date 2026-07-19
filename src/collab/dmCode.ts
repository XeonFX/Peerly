import { dmRoomCode as coreDmRoomCode } from '@peerly/core'

/** Peerly app scheme — must stay stable (existing DM room codes). */
export const PEERLY_DM_SCHEME = 'peerly-dm-v1'

/** 32 hex chars for both peers of a global friend DM. */
export async function dmRoomCode(userIdA: string, userIdB: string): Promise<string> {
  return coreDmRoomCode(userIdA, userIdB, PEERLY_DM_SCHEME)
}
