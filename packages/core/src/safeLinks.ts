export type SafeTextPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }

const URL_CANDIDATE = /https:\/\/[^\s<]+/gi
const TRAILING_PUNCTUATION = new Set([')', ',', '.', '!', '?', ';', ':', "'", ']'])

function trailingPunctuationStart(value: string): number {
  let index = value.length
  while (index > 0 && TRAILING_PUNCTUATION.has(value[index - 1])) index -= 1
  return index
}

/**
 * Splits user-authored text into inert text and HTTPS links.
 *
 * The parser deliberately accepts only HTTPS. Consumers can render `href`
 * directly without accidentally introducing `javascript:`, `data:`, or
 * application-specific message links.
 */
export function splitSafeLinks(text: string): SafeTextPart[] {
  const parts: SafeTextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ kind: 'text', value: text.slice(cursor, index) })
    const candidate = match[0]
    const trailingStart = trailingPunctuationStart(candidate)
    const value = candidate.slice(0, trailingStart)
    const trailing = candidate.slice(trailingStart)
    try {
      const parsed = new URL(value)
      parts.push(
        parsed.protocol === 'https:'
          ? { kind: 'link', value, href: parsed.href }
          : { kind: 'text', value }
      )
    } catch {
      parts.push({ kind: 'text', value })
    }
    if (trailing) parts.push({ kind: 'text', value: trailing })
    cursor = index + candidate.length
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }]
}

/** The first visible HTTPS URL in a message, for a “Copy link” action. */
export function firstSafeLink(text: string): string | null {
  return splitSafeLinks(text).find(part => part.kind === 'link')?.value ?? null
}
