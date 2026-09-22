/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('renderGoogleSignInButton', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
  })

  it('initializes Google once and routes later buttons through the stable callback', async () => {
    let callback: ((response: { credential: string }) => void) | undefined
    const initialize = vi.fn((config: { callback: typeof callback }) => {
      callback = config.callback
    })
    const renderButton = vi.fn()
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: { accounts: { id: { initialize, renderButton } } },
    })
    const { renderGoogleSignInButton } = await import('./googleSignIn.js')
    const container = document.createElement('div')

    const first = renderGoogleSignInButton(container, 'device-key', 'client-id')
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'))
    callback?.({ credential: 'token-1' })
    await expect(first).resolves.toBe('token-1')

    const second = renderGoogleSignInButton(container, 'device-key', 'client-id')
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2))
    callback?.({ credential: 'token-2' })
    await expect(second).resolves.toBe('token-2')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(renderButton).toHaveBeenCalledTimes(2)
  })

  it('keeps a visible-button initialization eligible for later silent renewal', async () => {
    let callback: ((response: { credential: string }) => void) | undefined
    const initialize = vi.fn((config: {
      auto_select?: boolean
      callback: typeof callback
    }) => {
      callback = config.callback
    })
    const prompt = vi.fn()
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: { accounts: { id: { initialize, renderButton: vi.fn(), prompt } } },
    })
    const {
      renderGoogleSignInButton,
      requestGoogleCredentialSilently,
    } = await import('./googleSignIn.js')
    const visible = renderGoogleSignInButton(
      document.createElement('div'),
      'device-key',
      'client-id'
    )
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'))
    callback?.({ credential: 'visible-token' })
    await expect(visible).resolves.toBe('visible-token')

    const renewal = requestGoogleCredentialSilently('client-id', 'device-key')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    callback?.({ credential: 'renewed-token' })

    await expect(renewal).resolves.toBe('renewed-token')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize.mock.calls[0]?.[0].auto_select).toBe(true)
  })
})
