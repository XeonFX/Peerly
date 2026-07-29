import { defineUserGateway } from '../../packages/core/worker/realtime/gateway/userGateway.mjs'
import {
  CONTENT_COMMANDS,
  createContentHandlers,
} from './commands/content.mjs'

/** Peerly's app composition over the shared authenticated account gateway. */
export const UserGatewayDO = defineUserGateway({
  commands: CONTENT_COMMANDS,
  handlers: deps =>
    createContentHandlers({
      clock: deps.clock,
      appName: deps.appName,
      opaqueUserIdSecret: deps.env.OPAQUE_USER_ID_SECRET,
      channels: deps.env.CONTENT_CHANNELS ?? null,
    }),
})
