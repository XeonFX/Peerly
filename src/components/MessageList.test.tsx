// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { ClockFormatProvider } from '@peerly/core/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import type { Message } from '../types'
import { MessageList } from './MessageList'

function message(
  id: string,
  senderId: string,
  senderName: string,
  timestamp: number
): Message {
  return {
    id,
    text: id,
    senderId,
    senderName,
    senderColor: '#5865f2',
    timestamp,
    channelId: 'general',
    type: 'text',
  }
}

describe('MessageList presentation', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('peerly-locale', 'en')
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders consecutive messages as lines under one dated sender header', () => {
    const firstTimestamp = new Date(2026, 6, 28, 14, 5).getTime()
    const onOpenAuthor = vi.fn()
    render(
      <ClockFormatProvider appId="peerly-test">
        <I18nProvider>
          <MessageList
            messages={[
              message('one', 'alice', 'Alice', firstTimestamp),
              message('two', 'alice', 'Alice', firstTimestamp + 30_000),
              message('three', 'bob', 'Bob', firstTimestamp + 60_000),
            ]}
            channelId="general"
            selfId="self"
            selfProfile={{ name: 'Me', color: '#36c5f0' }}
            peers={[]}
            transfers={[]}
            onRequestFile={vi.fn()}
            onNsfwVerdict={vi.fn()}
            onEditMessage={vi.fn()}
            onDeleteMessage={vi.fn()}
            onToggleReaction={vi.fn()}
            onReplyMessage={vi.fn()}
            onOpenAuthor={onOpenAuthor}
          />
        </I18nProvider>
      </ClockFormatProvider>
    )

    const rows = screen.getAllByTestId('chat-message')
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.dataset.messageGroupStart)).toEqual(['true', 'false', 'true'])
    expect(rows[0]?.classList.contains('mt-1')).toBe(true)
    expect(rows[0]?.classList.contains('py-1')).toBe(true)
    expect(rows[1]?.classList.contains('py-0')).toBe(true)

    expect(screen.queryByTestId('message-reactions')).toBeNull()
    const actions = screen.getAllByTestId('message-actions')
    expect(actions).toHaveLength(3)
    expect(actions.every(toolbar => toolbar.classList.contains('absolute'))).toBe(true)
    expect(screen.getAllByLabelText('React ❤️')).toHaveLength(3)
    expect(screen.getAllByLabelText('React 👍')).toHaveLength(3)
    expect(screen.getAllByLabelText('React 😂')).toHaveLength(3)

    const timestamps = screen.getAllByTestId('message-time')
    expect(timestamps).toHaveLength(2)
    expect(timestamps[0]?.textContent).toContain('2026')
    expect(timestamps[0]?.textContent).toContain('14:05')
    expect(timestamps[1]?.textContent).not.toContain('2026')

    fireEvent.click(screen.getByLabelText('Open Alice profile'))
    expect(onOpenAuthor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one' }),
      expect.objectContaining({ name: 'Alice' }),
      false
    )
  })
})
