import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, initializeTheme, loadThemePreference } from './themePreference'

function storage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next
    }),
  }
}

describe('themePreference', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the saved theme before the system preference', () => {
    vi.stubGlobal('localStorage', storage('light'))
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(loadThemePreference()).toBe('light')
  })

  it('uses the OS preference when no choice was saved', () => {
    vi.stubGlobal('localStorage', storage())
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(loadThemePreference()).toBe('dark')
  })

  it('applies the DaisyUI theme and color scheme before rendering', () => {
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } }
    vi.stubGlobal('localStorage', storage('dark'))
    vi.stubGlobal('document', { documentElement, querySelector: () => null })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })

    expect(initializeTheme()).toBe('dark')
    expect(documentElement.dataset.theme).toBe('peerly-dark')
    expect(documentElement.style.colorScheme).toBe('dark')

    applyTheme('light')
    expect(documentElement.dataset.theme).toBe('peerly')
  })
})
