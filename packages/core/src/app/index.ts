/**
 * Composition pieces an app wires together: the command loop and the handlers
 * for the commands every app gets. An app supplies its own registry entries
 * and handlers alongside these.
 */
export {
  GatewayService,
  type CommandContext, type CommandHandler, type GatewayServiceOptions,
} from './gatewayService.js'
export {
  createCoreHandlers, deliverToAccount, socketSetOf,
  type CoreHandlerDeps,
} from './coreHandlers.js'
