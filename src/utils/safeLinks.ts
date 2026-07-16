export type TextPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string }

const URL_CANDIDATE = /https:\/\/[^\s<]+/gi
const TRAILING_PUNCTUATION = /[),.!?;:'\]]+$/

export function splitSafeLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ kind: 'text', value: text.slice(cursor, index) })
    const candidate = match[0]
    const trailing = candidate.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const value = trailing ? candidate.slice(0, -trailing.length) : candidate
    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'https:') {
        parts.push({ kind: 'link', value, href: parsed.href })
      } else {
        parts.push({ kind: 'text', value })
      }
    } catch {
      parts.push({ kind: 'text', value })
    }
    if (trailing) parts.push({ kind: 'text', value: trailing })
    cursor = index + candidate.length
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }]
}
