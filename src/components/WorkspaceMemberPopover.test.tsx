// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { WorkspaceMemberPopover } from './WorkspaceMemberPopover'

describe('WorkspaceMemberPopover', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('peerly-locale', 'en')
  })
  afterEach(cleanup)

  it('renders the profile avatar as one circle without a nested avatar frame', () => {
    render(
      <I18nProvider>
        <WorkspaceMemberPopover
          member={{ kind: 'self', profile: { name: 'Alice', color: '#5865f2' } }}
          onClose={vi.fn()}
          onEditProfile={vi.fn()}
          onRequestFriend={vi.fn()}
          onSendMessage={vi.fn()}
        />
      </I18nProvider>
    )

    const dialog = screen.getByTestId('workspace-member-popover')
    const avatar = dialog.querySelector('.avatar-lg')
    expect(avatar?.classList.contains('rounded-full')).toBe(true)
    expect(avatar?.parentElement).toBe(dialog.querySelector('.flex.items-start'))
  })

  it('preserves a message draft across unrelated parent renders', () => {
    const member = {
      kind: 'peer' as const,
      peer: { id: 'alice-tab', userId: 'alice', name: 'Alice', color: '#5865f2' },
      contact: { userId: 'alice', email: 'alice@example.test', name: 'Alice' },
      friend: true,
      canMessage: true,
    }
    const view = render(
      <I18nProvider>
        <WorkspaceMemberPopover
          member={member}
          onClose={vi.fn()}
          onEditProfile={vi.fn()}
          onRequestFriend={vi.fn()}
          onSendMessage={vi.fn()}
        />
      </I18nProvider>
    )
    const input = screen.getByTestId('workspace-member-message-input')
    fireEvent.change(input, { target: { value: 'Do not clear me' } })

    view.rerender(
      <I18nProvider>
        <WorkspaceMemberPopover
          member={{ ...member, peer: { ...member.peer } }}
          onClose={vi.fn()}
          onEditProfile={vi.fn()}
          onRequestFriend={vi.fn()}
          onSendMessage={vi.fn()}
        />
      </I18nProvider>
    )

    expect(
      (screen.getByTestId('workspace-member-message-input') as HTMLInputElement).value
    ).toBe('Do not clear me')
  })
})
