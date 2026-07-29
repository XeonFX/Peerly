/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRoomAction } from './useRoomAction'

describe('useRoomAction', () => {
  it('keeps a queued send pending until the bound transport acknowledges it', async () => {
    let acknowledge: (() => void) | undefined
    const transportSend = vi.fn(
      () => new Promise<void>(resolve => {
        acknowledge = resolve
      })
    )
    const { result } = renderHook(() =>
      useRoomAction<{ text: string }>({ queueWhenUnbound: true })
    )

    const queued = result.current.send({ text: 'persist me' })
    let settled = false
    void queued.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    act(() => result.current.bind({ send: transportSend }))
    expect(transportSend).toHaveBeenCalledWith({ text: 'persist me' }, undefined)
    expect(settled).toBe(false)

    acknowledge?.()
    await expect(queued).resolves.toBeUndefined()
  })

  it('rejects queued work when its workspace scope is cleared', async () => {
    const transportSend = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useRoomAction<string>({ queueWhenUnbound: true })
    )

    const queued = result.current.send('old workspace')
    const rejected = expect(queued).rejects.toThrow('room-action-scope-changed')
    act(() => result.current.clearPending())
    await rejected

    act(() => result.current.bind({ send: transportSend }))
    expect(transportSend).not.toHaveBeenCalled()
  })

  it('flushes queued messages in acknowledgement order', async () => {
    const { result } = renderHook(() =>
      useRoomAction<string>({ queueWhenUnbound: true })
    )
    const first = result.current.send('first')
    const second = result.current.send('second')
    let acknowledgeFirst = (): void => {}
    const transportSend = vi.fn((value: string) =>
      value === 'first'
        ? new Promise<void>(resolve => {
            acknowledgeFirst = resolve
          })
        : Promise.resolve()
    )

    act(() => result.current.bind({ send: transportSend }))
    await vi.waitFor(() => expect(transportSend).toHaveBeenCalledTimes(1))
    expect(transportSend).toHaveBeenNthCalledWith(1, 'first', undefined)

    acknowledgeFirst()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(transportSend).toHaveBeenNthCalledWith(2, 'second', undefined)
  })
})
