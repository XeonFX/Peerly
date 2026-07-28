export function buildMessageLink(messageId: string, href = window.location.href): string {
  const url = new URL(href)
  url.hash = `message=${encodeURIComponent(messageId)}`
  return url.toString()
}

export function messageIdFromHash(hash = window.location.hash): string | null {
  const match = /^#message=(.+)$/.exec(hash)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

export function scrollToLinkedMessage(hash = window.location.hash): boolean {
  const messageId = messageIdFromHash(hash)
  if (!messageId) return false
  const element = document.getElementById(`message-${messageId}`)
  if (!element) return false
  element.scrollIntoView({ block: 'center' })
  element.focus({ preventScroll: true })
  return true
}
