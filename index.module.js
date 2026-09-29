    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import { getAuth, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    const firebaseConfig = {
      apiKey: "AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo",
      authDomain: "fir-asistencia-fad12.firebaseapp.com",
      databaseURL: "https://fir-asistencia-fad12-default-rtdb.firebaseio.com",
      projectId: "fir-asistencia-fad12",
      storageBucket: "fir-asistencia-fad12.firebasestorage.app",
      messagingSenderId: "441100861030",
      appId: "1:441100861030:web:b4287e1c3a377cf892b7a7"
    };

    // Instancia dedicada para NO interferir con ninguna otra sesión de la app.
    const vigApp  = initializeApp(firebaseConfig, "VigAuthApp");
    const vigAuth = getAuth(vigApp);
    // La sesión sólo vive mientras la pestaña esté abierta (dispositivo
    // compartido). Al cerrar la pestaña, Firebase no restaura la sesión.
    try { setPersistence(vigAuth, browserSessionPersistence); } catch (_) {}

    /**
     * Inicia y MANTIENE la sesión del vigilador contra Firebase Auth.
     * El empleado se autentica con el correo sintético legajo@demo.asistencia
     * y el PIN completado a 6 dígitos con ceros a la izquierda (igual que en el alta).
     * Devuelve el idToken para leer/escribir SOLO sus propios datos (?auth=).
     * @returns {Promise<{ok:boolean, idToken?:string, uid?:string, razon?:string}>}
     */
    async function loginVigilador(legajo, pin) {
      const legajoLimpio = String(legajo || '').trim();
      const pinLimpio    = String(pin || '').trim();
      if (!legajoLimpio || !pinLimpio) return { ok: false, razon: 'faltan_datos' };
      const email    = `${legajoLimpio}@demo.asistencia`;
      const password = pinLimpio.padStart(6, '0');
      try {
        const cred = await signInWithEmailAndPassword(vigAuth, email, password);
        const idToken = await cred.user.getIdToken();
        sincronizarRelojDesdeToken(idToken); // fijamos la hora oficial del servidor al iniciar sesion
        return { ok: true, idToken, uid: cred.user.uid };
      } catch (e) {
        return { ok: false, razon: (e && e.code) || 'error' };
      }
    }

    // Cierra la sesión activa del vigilador (dispositivo compartido / logout).
    async function logoutVigilador() {
      try { await signOut(vigAuth); } catch (_) {}
    }

    // ---- HORA OFICIAL DEL SERVIDOR (validacion de reloj de la fichada) ----
    // No confiamos en el reloj del telefono para la hora de la fichada. Tomamos la
    // hora del servidor desde el sello 'iat' del idToken de Google (se emite con la
    // hora del servidor y lo renovamos justo ANTES de fichar). Con eso calculamos el
    // desfase del reloj local, sellamos la fichada con la hora oficial estimada y, si
    // el telefono tiene la hora cambiada mas alla de la tolerancia, marcamos la
    // fichada para revision (alertaFraude) para que el admin la vea.
    const UMBRAL_DESFASE_RELOJ_MS = 120000; // 2 minutos de tolerancia
    let offsetRelojServidorMs = null;       // horaServidor - horaDispositivo (ms)

    function decodificarPayloadJwt(token) {
      try {
        const parte = String(token).split('.')[1];
        if (!parte) return null;
        const base = parte.replace(/-/g, '+').replace(/_/g, '/');
        const relleno = base + '==='.slice((base.length + 3) % 4);
        return JSON.parse(atob(relleno));
      } catch (_) { return null; }
    }
    // Recalcula el desfase del reloj local usando la hora del servidor (iat del token).
    function sincronizarRelojDesdeToken(token) {
      const p = decodificarPayloadJwt(token);
      if (p && Number.isFinite(p.iat)) {
        offsetRelojServidorMs = (p.iat * 1000) - Date.now();
      }
    }
    // Hora oficial estimada (ms) = reloj local corregido por el desfase del servidor.
    function ahoraServidorMs() {
      return (typeof offsetRelojServidorMs === 'number') ? (Date.now() + offsetRelojServidorMs) : Date.now();
    }
    // Sella la fichada con la hora oficial y detecta relojes manipulados.
    // 'validado' es true SOLO cuando pudimos obtener hora fresca del servidor
    // (fichaje online con token recien renovado); offline no se puede validar.
    function aplicarHoraServidor(datos, validado) {
      const desfase = (typeof offsetRelojServidorMs === 'number') ? offsetRelojServidorMs : null;
      datos.horaServidorFichaje = new Date(ahoraServidorMs()).toISOString();
      datos.desfaseRelojMs = desfase;
      datos.horaValidadaPorServidor = !!validado;
      datos.relojDesincronizado = (!!validado) && (desfase !== null) && (Math.abs(desfase) > UMBRAL_DESFASE_RELOJ_MS);
      if (datos.relojDesincronizado) {
        const seg = Math.round(Math.abs(desfase) / 1000);
        datos.alertaFraude = true;
        const nota = 'Reloj del dispositivo desincronizado ~' + seg + 's respecto de la hora oficial del servidor.';
        datos.motivoFraude = datos.motivoFraude ? (datos.motivoFraude + ' | ' + nota) : nota;
      }
      return datos;
    }

    // Devuelve un idToken fresco de la sesión activa (o null). Útil para
    // renovar el token antes de operaciones tras varios minutos de uso.
    async function refrescarTokenVigilador() {
      try {
        if (vigAuth.currentUser) {
          const t = await vigAuth.currentUser.getIdToken(true);
          sincronizarRelojDesdeToken(t); // aprovechamos el token fresco para tomar la hora oficial
          return t;
        }
      } catch (_) {}
      return null;
    }

    window.loginVigilador = loginVigilador;
    window.logoutVigilador = logoutVigilador;
    window.refrescarTokenVigilador = refrescarTokenVigilador;