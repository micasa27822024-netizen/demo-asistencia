/* Demo Asistencia - capa de seguridad para peticiones REST a Realtime Database. */
(function () {
  'use strict';
  if (!window.fetch) return;
  const originalFetch = window.fetch.bind(window);
  let installed = false;

  function isFirebaseRest(url) {
    try {
      const u = new URL(url, window.location.href);
      return /\.firebaseio\.com$/.test(u.hostname) || /\.firebasedatabase\.app$/.test(u.hostname);
    } catch (_) {
      return false;
    }
  }

  window.fetch = async function secureFirebaseFetch(input, init) {
    let url = typeof input === 'string' ? input : input?.url;
    if (!isFirebaseRest(url)) return originalFetch(input, init);

    try {
      if (window.DAAuth?.init) await window.DAAuth.init();
      const user = await window.DAAuth?.currentUser?.();
      if (user) {
        const token = await user.getIdToken();
        const u = new URL(url, window.location.href);
        u.searchParams.set('auth', token);
        url = u.toString();
        if (typeof input === 'string') return originalFetch(url, init);
        const headers = new Headers(input.headers || {});
        return originalFetch(new Request(url, { ...input, headers }), init);
      }
    } catch (error) {
      console.warn('No se pudo adjuntar el token Firebase a la petición REST:', error);
    }
    return originalFetch(input, init);
  };

  installed = true;
  window.DASecurity = { installed };
})();
