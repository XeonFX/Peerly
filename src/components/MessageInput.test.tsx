// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { MessageInput } from './MessageInput'

afterEach(cleanup)
it('keeps the draft when enqueue fails, and clears it only after durable acceptance', async () => {
  localStorage.clear()
  const send = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce(undefined)
  render(<I18nProvider><MessageInput draftKey="test-draft" onSend={send} onFiles={() => {}} /></I18nProvider>)
  const input = screen.getByTestId('message-input') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'do not lose this' } })
  fireEvent.submit(screen.getByTestId('message-composer'))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('draft is still here'))
  expect(input.value).toBe('do not lose this')
  expect(localStorage.getItem('test-draft')).toBe('do not lose this')
  fireEvent.submit(screen.getByTestId('message-composer'))
  await waitFor(() => expect(input.value).toBe(''))
  expect(localStorage.getItem('test-draft')).toBeNull()
})
