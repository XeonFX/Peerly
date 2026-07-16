export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'peerly-theme'
export const THEME_EVENT = 'peerly-theme-changed'

function systemTheme(): ThemePreference {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function loadThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable in private/locked-down browser contexts.
  }
  return systemTheme()
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return
  const themeName = theme === 'dark' ? 'peerly-dark' : 'peerly'
  document.documentElement.dataset.theme = themeName
  document.documentElement.style.colorScheme = theme

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', theme === 'dark' ? '#111221' : '#f8f8ff')
}

export function initializeTheme(): ThemePreference {
  const theme = loadThemePreference()
  applyTheme(theme)
  return theme
}

export function saveThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // The theme still applies for this page even if it cannot be persisted.
  }
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_EVENT, { detail: theme }))
}
