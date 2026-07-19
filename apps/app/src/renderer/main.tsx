import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@spool-lab/ui/styles.css'
import './styles.css'
// Initialize i18next before any component renders so the first paint already
// has translations. App owns the runtime locale-resolution effect.
import './i18n/index.js'
import App from './App.js'

const preferredColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const applyPreferredColorScheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
}
applyPreferredColorScheme(preferredColorScheme.matches)
preferredColorScheme.addEventListener('change', (event) => applyPreferredColorScheme(event.matches))

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
