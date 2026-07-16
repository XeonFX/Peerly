import { useEffect, useState } from 'react'
import {
  loadThemePreference,
  saveThemePreference,
  THEME_EVENT,
  type ThemePreference,
} from '../collab/themePreference'
import { Icon } from './Icon'
import { useI18n } from '../i18n'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { tr } = useI18n()
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
      aria-label={tr(next === 'light' ? 'Switch to light mode' : 'Switch to dark mode')}
      title={tr(next === 'light' ? 'Switch to light mode' : 'Switch to dark mode')}
      data-testid="theme-toggle"
      onClick={() => {
        saveThemePreference(next)
        setTheme(next)
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      {!compact && <span>{tr(theme === 'dark' ? 'Light mode' : 'Dark mode')}</span>}
    </button>
  )
}
