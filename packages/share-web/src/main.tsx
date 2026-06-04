import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Share-kit's global.css pulls in Tailwind + Fontsource imports that
// would require Tailwind in this package. The chrome lives in
// `./styles.css` (self-hosted, CSP-safe). We *do* bundle our own
// Geist subset via @fontsource so the design system's typography
// resolves predictably across the 5 pages — the font files end up
// in dist/assets and load same-origin under `font-src 'self'`.
import '@fontsource-variable/geist/index.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'
import './styles.css'

import { App } from './App'
import { bootTheme } from './components/Chrome'

bootTheme()

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
