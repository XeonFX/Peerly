import { useEffect, useState } from 'react'
import {
  loadThemePreference,
  saveThemePreference,
  THEME_EVENT,
  type ThemePreference,
} from '../collab/themePreference'
import { Icon } from './Icon'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference())

  useEffect(() => {
    const onTheme = (event: Event) => {
      setTheme((event as CustomEvent<ThemePreference>).detail)
    }
    window.addEventListener(THEME_EVENT, onTheme)
    return () => window.removeEventListener(THEME_EVENT, onTheme)
  }, [])

  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={compact ? 'btn btn-ghost btn-square btn-sm' : 'btn btn-outline btn-sm'}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      data-testid="theme-toggle"
      onClick={() => {
        saveThemePreference(next)
        setTheme(next)
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      {!compact && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  )
}
