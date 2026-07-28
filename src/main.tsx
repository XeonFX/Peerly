import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initializeTheme } from './collab/themePreference.ts'
import { I18nProvider } from './i18n.tsx'
import { ClockFormatProvider } from '@peerly/core/react'
import { APP_STORAGE_SCOPE } from './config.ts'

// Apply the saved/system theme before React paints to avoid a light-mode flash.
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClockFormatProvider appId={APP_STORAGE_SCOPE}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ClockFormatProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Keep development and E2E deterministic; production installs an offline app
// shell and runtime-caches the hashed assets loaded by the current release.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('[Peerly] Service worker registration failed:', error)
    })
  })
}
