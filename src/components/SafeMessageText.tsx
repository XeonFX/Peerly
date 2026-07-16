import { splitSafeLinks } from '../utils/safeLinks'

export function SafeMessageText({ text }: { text: string }) {
  return (
    <p className="break-words whitespace-pre-wrap">
      {splitSafeLinks(text).map((part, index) =>
        part.kind === 'link' ? (
          <a
            key={`${index}-${part.href}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {part.value}
          </a>
        ) : (
          part.value
        )
      )}
    </p>
  )
}
