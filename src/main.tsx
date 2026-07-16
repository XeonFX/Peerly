import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializeTheme } from './collab/themePreference.ts'

// Apply the saved/system theme before React paints to avoid a light-mode flash.
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
