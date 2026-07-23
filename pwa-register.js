(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      await navigator.serviceWorker.ready;
      console.info('Radar Conte PWA pronta', registration.scope);
    } catch (error) {
      console.error('Registrazione PWA non riuscita', error);
    }
  });
})();
