import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
// Initialize i18next before any component renders so the first paint already
// has translations. App owns the runtime locale-resolution effect.
import './i18n/index.js'
import App from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
