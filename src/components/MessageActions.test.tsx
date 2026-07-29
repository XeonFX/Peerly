// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { MessageActions } from './MessageActions'

describe('MessageActions', () => {
  const clipboardWrite = vi.fn(async () => {})

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('peerly-locale', 'en')
    clipboardWrite.mockClear()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
  })
  afterEach(cleanup)

  function renderActions(text: string, onReact = vi.fn()) {
    render(
      <I18nProvider>
        <MessageActions
          text={text}
          canEdit
          canDelete
          onReact={onReact}
          onReply={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </I18nProvider>
    )
    return onReact
  }

  it('dispatches reactions selected from the full picker', () => {
    const onReact = renderActions('Hello')
    fireEvent.click(screen.getByLabelText('Add reaction'))
    fireEvent.click(screen.getByLabelText('React 🚀'))
    expect(onReact).toHaveBeenCalledWith('🚀')
  })

  it('copies the first URL from the message instead of a message permalink', () => {
    renderActions('See https://first.example/docs, then https://second.example.')
    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(screen.getByText('Copy link'))
    expect(clipboardWrite).toHaveBeenCalledWith('https://first.example/docs')
  })

  it('does not offer Copy link when the message has no URL', () => {
    renderActions('No links here')
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByText('Copy link')).toBeNull()
  })
})
