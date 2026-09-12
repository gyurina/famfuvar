import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'


// Service Worker regisztráció (push értesítések + offline)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // SUPABASE_URL átadása a SW-nek push-receipt callbackhoz
    const swTarget = reg.installing ?? reg.waiting ?? reg.active
    const msg = { type: 'CONFIG', supabaseUrl: import.meta.env.VITE_SUPABASE_URL }
    swTarget?.postMessage(msg)
    // Ha later aktiválódik:
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      navigator.serviceWorker.controller?.postMessage(msg)
    })
  }).catch(e => console.warn('SW registration failed:', e))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
