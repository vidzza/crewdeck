import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
  // Tapping a notification while the app is open: go to the screen it's about.
  navigator.serviceWorker.addEventListener('message', (e) => {
    const hash = e.data?.type === 'crewdeck-open' ? e.data.hash : null
    if (typeof hash === 'string' && hash.startsWith('#/')) location.hash = hash
  })
}
