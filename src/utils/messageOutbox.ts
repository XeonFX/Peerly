import { createIndexedDbOutboxStorage } from '@peerly/core'
export { createMessageOutbox, type OutboxEntry, type OutboxStorage } from '@peerly/core'
export const messageOutboxStorage = createIndexedDbOutboxStorage('peerly-message-outbox-v1')
