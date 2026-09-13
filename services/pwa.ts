export function setupPWA() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // In local development, unregister any stale service workers to prevent cached assets blocking changes
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((unregistered) => {
          if (unregistered) console.log('[NIR PWA] Development mode: unregistered service worker');
        });
      }
    });
    return;
  }

  // Migration: this origin previously served a different (Firebase) application, so a
  // legacy service worker may still be registered at another path and intercept
  // navigations or requests. Remove anything that is not our own /sw.js.
  const expectedScriptUrl = new URL('/sw.js', window.location.origin).href;
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => {
      const worker = registration.active || registration.waiting || registration.installing;
      if (worker && worker.scriptURL !== expectedScriptUrl) {
        console.warn('[NIR PWA] Removing stale service worker from a previous app:', worker.scriptURL);
        return registration.unregister();
      }
      return Promise.resolve(false);
    })))
    .catch(() => { /* service worker API unavailable - app still works without it */ });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[NIR PWA] Service worker registered with scope:', registration.scope);

        // Check for updates periodically
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[NIR PWA] New update available; reloading for latest version...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[NIR PWA] Service worker registration failed:', error);
      });

    // Reload once when the new controller takes over
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
