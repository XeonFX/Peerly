import { useMessageOutbox as useCoreMessageOutbox } from '@peerly/core/react'
import { messageOutboxStorage } from '../utils/messageOutbox'
export function useMessageOutbox<T extends { id: string }>(scope: string | null, enabled: boolean, deliver: (payload: T) => Promise<void>) {
  return useCoreMessageOutbox(messageOutboxStorage, scope, enabled, deliver)
}
