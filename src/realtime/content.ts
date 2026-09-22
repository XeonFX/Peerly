import {
  sendRealtimeCommand,
  deriveChannelCapability,
  type DurableChannelAuthorization,
} from '@peerly/core'
import type { SignedAllowList } from '../collab/allowList'
import { NETWORK_APP_ID } from '../config'

export async function authorizeWorkspaceContent(input: {
  capability: string
  creatorKeyId: string
  allowList: SignedAllowList
}): Promise<DurableChannelAuthorization> {
  const capability = await deriveChannelCapability(input.capability, `workspace-content:${input.creatorKeyId}`)
  if (input.allowList.scope !== capability) {
    throw new Error('The workspace creator must open this workspace and share its updated invite before encrypted history can connect.')
  }
  return sendRealtimeCommand<DurableChannelAuthorization>(
    NETWORK_APP_ID,
    'workspace.content.authorize',
    {
      ...input,
      capability,
    }
  )
}
export async function authorizeDmContent(
  capability: string,
  peerUserId: string
): Promise<DurableChannelAuthorization> {
  return sendRealtimeCommand<DurableChannelAuthorization>(
    NETWORK_APP_ID,
    'dm.content.authorize',
    { capability: await deriveChannelCapability(capability, 'dm-content'), peerUserId }
  )
}
