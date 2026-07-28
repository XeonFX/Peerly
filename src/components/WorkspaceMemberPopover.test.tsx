// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
})
