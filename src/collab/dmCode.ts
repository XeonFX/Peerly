import { dmRoomCode as coreDmRoomCode } from '@peerly/core'

/** Peerly app namespace — keep stable across compatible secure-DM releases. */
export const PEERLY_DM_SCHEME = 'peerly-dm-v2'

/** 32 hex chars for both peers of a global friend DM. */
export async function dmRoomCode(
  userIdA: string,
  userIdB: string,
  sharedSecret: string
): Promise<string> {
  return coreDmRoomCode(userIdA, userIdB, PEERLY_DM_SCHEME, sharedSecret)
}
