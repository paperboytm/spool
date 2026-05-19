import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Share-kit's global.css pulls in Tailwind + Fontsource imports that
// would require Tailwind+@fontsource in this package and would also
// breach the strict CSP (`font-src 'self' data:`). Skip it — templates
// render with inline styles already, and the small amount of chrome we
// add here lives in `./styles.css` (self-hosted, CSP-safe).
import './styles.css'

import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
