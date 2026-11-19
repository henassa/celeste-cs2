import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary'
import { loadUserMaps } from './maps/maps'
import { registerServiceWorker, setupNativeBack } from './app/pwa'


const root = createRoot(document.getElementById('root')!)

// Erreur hors React (chargement d'un module, promesse rejetée au démarrage) : on l'affiche aussi
let shown = false
const showFatal = (err: unknown) => {
  if (shown || document.getElementById('root')?.childElementCount) return
  shown = true
  root.render(<ErrorScreen error={err} />)
}
window.addEventListener('error', (e) => showFatal(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason))

registerServiceWorker()
setupNativeBack()

// Maps ajoutées sur cette machine (workshop) : chargées avant le premier rendu
loadUserMaps().finally(() => root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
))
