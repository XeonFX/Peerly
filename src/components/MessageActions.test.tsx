// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { MessageActions } from './MessageActions'

function renderActions(overrides: Partial<React.ComponentProps<typeof MessageActions>> = {}) {
  const props: React.ComponentProps<typeof MessageActions> = {
    messageId: 'message-1',
    text: 'Hello',
    canEdit: true,
    canDelete: true,
    onReact: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<I18nProvider><MessageActions {...props} /></I18nProvider>)
  return props
}

describe('MessageActions', () => {
  afterEach(cleanup)
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('peerly-locale', 'en')
  })

  it('shows three default reactions and keeps every primary action on one row', () => {
    renderActions()
    expect(screen.getByLabelText('React ❤️')).toBeTruthy()
    expect(screen.getByLabelText('React 👍')).toBeTruthy()
    expect(screen.getByLabelText('React 😂')).toBeTruthy()
    expect(screen.getByLabelText('Add reaction')).toBeTruthy()
    expect(screen.getByLabelText('Reply')).toBeTruthy()
    expect(screen.getByLabelText('Edit message')).toBeTruthy()
    expect(screen.getByLabelText('Delete message')).toBeTruthy()
    expect(screen.getByLabelText('More actions')).toBeTruthy()
  })

  it('opens a categorized picker and filters reactions by keyword', () => {
    const props = renderActions()
    fireEvent.click(screen.getByLabelText('Add reaction'))

    const picker = screen.getByTestId('message-reaction-picker')
    expect(picker.parentElement).toBe(document.body)
    expect(picker.classList.contains('fixed')).toBe(true)
    expect(picker.classList.contains('z-100')).toBe(true)
    expect(screen.getByText('Smileys & people')).toBeTruthy()
    expect(screen.getByText('Gestures')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search reactions'), { target: { value: 'rocket' } })
    expect(screen.getByLabelText('React 🚀')).toBeTruthy()
    expect(screen.queryByText('Smileys & people')).toBeNull()

    fireEvent.click(screen.getByLabelText('React 🚀'))
    expect(props.onReact).toHaveBeenCalledWith('🚀')
  })

  it('puts secondary copy actions and all available operations in the more menu', () => {
    renderActions()
    fireEvent.click(screen.getByLabelText('More actions'))

    const menu = screen.getByTestId('message-more-menu')
    expect(menu.textContent).toContain('Add reaction')
    expect(menu.textContent).toContain('Reply')
    expect(menu.textContent).toContain('Edit message')
    expect(menu.textContent).toContain('Delete message')
    expect(menu.textContent).toContain('Copy text')
    expect(menu.textContent).toContain('Copy link')
  })
})
