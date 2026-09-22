/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCredentialRenewal } from './react.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('useCredentialRenewal', () => {
  it('renews a missing credential immediately and reports the result', async () => {
    vi.useFakeTimers()
    const renew = vi.fn().mockResolvedValue('credential')
    const onRenewed = vi.fn()

    const { result } = renderHook(() =>
      useCredentialRenewal({
        enabled: true,
        expiresAt: null,
        renew,
        onRenewed,
      })
    )

    await act(() => vi.runOnlyPendingTimersAsync())

    expect(renew).toHaveBeenCalledOnce()
    expect(onRenewed).toHaveBeenCalledWith('credential')
    expect(result.current).toBe(1)
  })

  it('retries a failed renewal only until the current credential expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const renew = vi.fn().mockResolvedValue(null)
    const onExpired = vi.fn()

    renderHook(() =>
      useCredentialRenewal({
        enabled: true,
        expiresAt: 1_002_000,
        renewBeforeMs: 5_000,
        retryMs: 60_000,
        renew,
        onRenewed: vi.fn(),
        onExpired,
      })
    )

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(renew).toHaveBeenCalledOnce()
    expect(onExpired).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(renew).toHaveBeenCalledTimes(2)
    expect(onExpired).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
