import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './theme/ThemeContext'
import AppErrorBoundary from './components/AppErrorBoundary'

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  } else {
    // Development (vite, netlify dev, staging runs): no service worker. sw.js serves /assets/
    // cache-first and keeps whatever it got, so a failed local run would leave broken images and
    // service-worker errors behind. Remove one an earlier run registered, and its caches.
    navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => r.unregister())).catch(() => {});
    globalThis.caches?.keys()
      .then((keys) => keys.filter((k) => k.startsWith('idynify-scout')).forEach((k) => globalThis.caches.delete(k)))
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Outside the theme provider on purpose: it must still render if the
        provider is what failed. */}
    <AppErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
