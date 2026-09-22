// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useConversationState } from './reactConversationState.js'
it('isolates render state and ignores async callbacks across A → B → A', () => {
  const hook = renderHook(({ scope }) => useConversationState<string[]>(scope, () => []), { initialProps: { scope: 'a' } })
  const oldSet = hook.result.current[1]
  act(() => oldSet(['private-a']))
  hook.rerender({ scope: 'b' })
  expect(hook.result.current[0]).toEqual([])
  act(() => oldSet(['late-a']))
  expect(hook.result.current[0]).toEqual([])
  hook.rerender({ scope: 'a' })
  act(() => oldSet(['stale-generation']))
  expect(hook.result.current[0]).toEqual([])
  act(() => hook.result.current[1](['fresh-a']))
  expect(hook.result.current[0]).toEqual(['fresh-a'])
  hook.unmount()
})
