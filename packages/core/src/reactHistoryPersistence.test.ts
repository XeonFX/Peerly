// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HISTORY_STORAGE_ERROR, useHistoryPersistence } from './reactHistoryPersistence.js'

afterEach(() => vi.useRealTimers())

it('reports failed writes, retries the latest snapshot, and stops retrying after success', () => {
  vi.useFakeTimers()
  const save = vi.fn(() => false)
  const hook = renderHook(({ value }) => useHistoryPersistence('room-a', true, value, save), { initialProps: { value: 'first' } })
  expect(hook.result.current.error).toBe(HISTORY_STORAGE_ERROR)
  hook.rerender({ value: 'latest' })
  save.mockReturnValue(true)
  act(() => vi.advanceTimersByTime(15_000))
  expect(save).toHaveBeenLastCalledWith('latest')
  expect(hook.result.current.error).toBeNull()
  const writes = save.mock.calls.length
  act(() => vi.advanceTimersByTime(30_000))
  expect(save).toHaveBeenCalledTimes(writes)
  hook.unmount()
})

it('does not let a previous conversation retry or overwrite the current status', () => {
  const save = vi.fn(() => false)
  const hook = renderHook(({ scope, enabled }) => useHistoryPersistence(scope, enabled, scope, save), { initialProps: { scope: 'a', enabled: true } })
  const oldRetry = hook.result.current.retry
  hook.rerender({ scope: 'b', enabled: false })
  act(() => oldRetry())
  expect(save).toHaveBeenCalledTimes(1)
  expect(hook.result.current.error).toBeNull()
  hook.unmount()
})
