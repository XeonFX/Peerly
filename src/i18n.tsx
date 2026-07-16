/* oxlint-disable react/only-export-components -- provider and its matching hook are one API. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'pl'
const LOCALE_KEY = 'peerly-locale'

const pl: Record<string, string> = {
  'settings.attention.title': 'Uwaga i powiadomienia',
  'settings.attention.description':
    'Liczba nieprzeczytanych wiadomości pojawia się automatycznie na karcie i ikonie. Powiadomienia przeglądarki są opcjonalne i dotyczą tylko wiadomości bezpośrednich, gdy Peerly działa w tle.',
  'settings.attention.enable': 'Włącz powiadomienia DM',
  'settings.attention.disable': 'Wyłącz powiadomienia DM',
  'settings.language': 'Język',
}

function initialLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY)
  if (saved === 'en' || saved === 'pl') return saved
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en'
}

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, english: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: next => {
        localStorage.setItem(LOCALE_KEY, next)
        document.documentElement.lang = next
        setLocaleState(next)
      },
      t: (key, english) => (locale === 'pl' ? (pl[key] ?? english) : english),
    }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}
