// Version web installable (PWA) et app Android (Capacitor).

/** L'app Android (Capacitor) : la page est servie par l'app elle-même, sans service worker. */
export const isNativeApp = typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Service worker (hors ligne) seulement sur le web : pas dans l'app de bureau (app://) ni dans l'app Android. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || isNativeApp || !/^https?:$/.test(location.protocol) || import.meta.env.DEV) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register(`./sw.js?v=${__APP_VERSION__}`).catch(() => { /* hors ligne indisponible : l'app marche quand même */ }); });
}

/** App Android : le bouton retour remonte l'historique de l'app (pages, rounds), et la quitte au début. */
export function setupNativeBack(): void {
  if (!isNativeApp) return;
  import('@capacitor/app').then(({ App }) => {
    void App.addListener('backButton', ({ canGoBack }) => {
      // Fenêtre ouverte (dialogue, palette) : Échap la ferme, comme sur ordinateur
      if (document.querySelector('[role=dialog]')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
      if (canGoBack || history.length > 1) history.back(); else void App.exitApp();
    });
  }).catch(() => { /* hors app native */ });
}
