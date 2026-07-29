import {
  sendRealtimeCommand,
  type DurableChannelAuthorization,
} from '@peerly/core'
import type { SignedAllowList } from '../collab/allowList'
import { NETWORK_APP_ID } from '../config'

export function authorizeWorkspaceContent(input: {
  capability: string
  creatorKeyId: string
  allowList: SignedAllowList
}): Promise<DurableChannelAuthorization> {
  return sendRealtimeCommand<DurableChannelAuthorization>(
    NETWORK_APP_ID,
    'workspace.content.authorize',
    input
  )
}
export function authorizeDmContent(
  capability: string,
  peerUserId: string
): Promise<DurableChannelAuthorization> {
  return sendRealtimeCommand<DurableChannelAuthorization>(
    NETWORK_APP_ID,
    'dm.content.authorize',
    { capability, peerUserId }
  )
}
