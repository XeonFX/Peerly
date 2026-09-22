import { defineAuthorizedChannel } from '../../packages/core/worker/realtime/gateway/authorizedChannel.mjs'

/**
 * Peerly's policy over the reusable encrypted Durable Object channel.
 *
 * Message revisions and reactions are an append-only signed event stream.
 * Channel definitions are retained so an offline member learns workspace
 * structure on reconnect. Profiles are live presence and are not history.
 * File bodies, file requests, and calls stay on the direct WebRTC room.
 */
export const ContentChannelDO = defineAuthorizedChannel({
  allowedEvents: [
    'chat',
    'reaction',
    'channel-sync',
    'profile',
    'gdm',
    'gdmreact',
  ],
  persistedEvents: ['chat', 'reaction', 'channel-sync', 'gdm', 'gdmreact'],
})
