import { Component, type ReactNode } from 'react'

/**
 * Last-resort boundary so one component's render error shows a recoverable
 * screen instead of a blank page. Deliberately avoids the i18n context (a
 * provider could be the thing that threw) — it reads the stored locale directly
 * and falls back to English.
 */
const MESSAGES = {
  pl: {
    title: 'Coś poszło nie tak',
    body: 'Aplikacja napotkała nieoczekiwany błąd. Odśwież stronę, aby kontynuować.',
    reload: 'Odśwież',
  },
  en: {
    title: 'Something went wrong',
    body: 'The app hit an unexpected error. Reload the page to continue.',
    reload: 'Reload',
  },
} as const

function strings() {
  try {
    return localStorage.getItem('peerly-locale') === 'pl' ? MESSAGES.pl : MESSAGES.en
  } catch {
    return MESSAGES.en
  }
}

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: unknown): void {
    console.error('[Peerly] render error:', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const t = strings()
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-base-100 p-8 text-center text-base-content">
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="max-w-sm text-sm text-base-content/70">{t.body}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
      </div>
    )
  }
}
