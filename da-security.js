/* Demo Asistencia - autenticación, roles y fetch autenticado */
(function () {
  'use strict';

  let firebaseApp = null;
  let auth = null;
  let functions = null;
  let initPromise = null;
  let authReadyPromise = null;
  let firebaseBaseUrl = '';
  const originalFetch = window.fetch.bind(window);
  let interceptorInstalled = false;

  function normalizarLegajo(valor) {
    const texto = String(valor ?? '').trim();
    if (/^\d+$/.test(texto)) return texto.replace(/^0+(?=\d)/, '');
    return texto.toUpperCase();
  }

  function getConfig() {
    return window.DAConfig?.current || null;
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const cfg = await window.DAConfig.ready;
      if (!window.firebase) throw new Error('Firebase SDK no fue cargado.');
      if (cfg?.estado === 'HOST_NO_REGISTRADO') {
        throw new Error(cfg.error || 'Dominio no registrado.');
      }

      const fbCfg = cfg.firebase || {};
      if (!fbCfg.apiKey || fbCfg.apiKey === 'AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo') {
        throw new Error('Falta la apiKey de Firebase en companies.json.');
      }
      if (!fbCfg.projectId || !fbCfg.authDomain) {
        throw new Error('Configuración Firebase incompleta: projectId/authDomain.');
      }

      if (!firebaseApp) {
        firebaseApp = firebase.apps?.length ? firebase.app() : firebase.initializeApp(fbCfg);
        auth = firebase.auth(firebaseApp);
        try {
          await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } catch (e) {
          console.warn('No se pudo configurar persistencia LOCAL de Firebase Auth.', e);
        }
        if (firebase.functions) {
          functions = firebase.functions(firebaseApp);
        }
      }

      firebaseBaseUrl = String(fbCfg.databaseURL || '').replace(/\/$/, '');
      installFirebaseFetchInterceptor(firebaseBaseUrl);

      if (!authReadyPromise) {
        authReadyPromise = new Promise(resolve => {
          const unsubscribe = auth.onAuthStateChanged(user => {
            unsubscribe();
            resolve(user || null);
          });
        });
      }

      return { app: firebaseApp, auth, functions, config: cfg };
    })();
    return initPromise;
  }

  function installFirebaseFetchInterceptor(baseUrl) {
    if (interceptorInstalled || !baseUrl) return;
    interceptorInstalled = true;
    window.fetch = async function (input, init) {
      const originalUrl = typeof input === 'string' ? input : input?.url;
      if (!originalUrl || !originalUrl.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }

      let user = null;
      try {
        user = auth?.currentUser || null;
      } catch (e) {}

      if (!user) return originalFetch(input, init);

      try {
        const token = await user.getIdToken();
        const url = new URL(originalUrl, window.location.href);
        if (!url.searchParams.has('auth')) url.searchParams.set('auth', token);
        if (typeof input === 'string') {
          return originalFetch(url.toString(), init);
        }
        const cloned = new Request(url.toString(), input);
        return originalFetch(cloned, init);
      } catch (e) {
        console.error('No se pudo adjuntar el token de Firebase a la petición.', e);
        return originalFetch(input, init);
      }
    };
  }

  async function waitForAuth() {
    await init();
    return authReadyPromise;
  }

  async function currentUser() {
    await init();
    return auth.currentUser || await waitForAuth();
  }

  async function roleOf(user, forceRefresh = false) {
    if (!user) return null;
    const token = await user.getIdTokenResult(forceRefresh);
    return token?.claims?.role || token?.claims?.rol || null;
  }

  async function requireRole(roles) {
    const user = await currentUser();
    if (!user) throw new Error('Sesión no autenticada.');
    const wanted = Array.isArray(roles) ? roles : [roles];
    const role = await roleOf(user);
    if (!wanted.includes(role)) {
      throw new Error(`Acceso denegado. Rol requerido: ${wanted.join(', ')}.`);
    }
    return { user, role };
  }

  function emailDeLegajo(legajo) {
    return `${normalizarLegajo(legajo)}@demo.asistencia`;
  }

  async function signInWithEmail(email, password) {
    await init();
    if (!email || !password) throw new Error('Ingrese correo y contraseña.');
    const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
    return cred.user;
  }

  async function signInLegajo(legajo, pin) {
    const uid = normalizarLegajo(legajo);
    if (!uid || !pin) throw new Error('Ingrese legajo y clave.');

    const existing = await currentUser();
    if (existing && normalizarLegajo(existing.uid) === uid) {
      return existing;
    }
    if (existing) await auth.signOut();
    return signInWithEmail(emailDeLegajo(uid), pin);
  }

  async function ensureVigilador(legajo, pin) {
    const cfg = await init();
    const uid = normalizarLegajo(legajo);
    let user = await currentUser();
    if (!user || normalizarLegajo(user.uid) !== uid) {
      if (!navigator.onLine) {
        throw new Error('Para fichar sin conexión debe existir una sesión de vigilador previamente autenticada en este dispositivo.');
      }
      user = await signInLegajo(uid, pin);
    }
    const role = await roleOf(user);
    if (role !== 'vigilador') {
      await auth.signOut();
      throw new Error('La cuenta autenticada no corresponde a un vigilador.');
    }
    return { user, role, config: cfg.config };
  }

  async function signOut() {
    await init();
    await auth.signOut();
  }

  async function callFunction(name, data) {
    await init();
    if (!functions) throw new Error('Firebase Functions no está disponible.');
    const fn = functions.httpsCallable(name);
    const result = await fn(data || {});
    return result.data;
  }

  async function authFetch(url, options = {}) {
    await init();
    return window.fetch(url, options);
  }

  async function getIdToken(forceRefresh = false) {
    const user = await currentUser();
    if (!user) throw new Error('No hay sesión autenticada.');
    return user.getIdToken(forceRefresh);
  }

  function base64urlToUint8Array(value) {
    const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const binary = atob(s + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function uint8ArrayToBase64url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function webauthnToJSON(value) {
    if (value instanceof ArrayBuffer) return uint8ArrayToBase64url(new Uint8Array(value));
    if (value instanceof Uint8Array) return uint8ArrayToBase64url(value);
    if (Array.isArray(value)) return value.map(webauthnToJSON);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = webauthnToJSON(item);
      return out;
    }
    return value;
  }

  function webauthnFromJSON(value) {
    if (!value || typeof value !== 'object') return value;
    const out = { ...value };
    ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle', 'rawId'].forEach(key => {
      if (typeof out[key] === 'string') out[key] = base64urlToUint8Array(out[key]);
    });
    return out;
  }

  async function registerWebAuthn() {
    const user = await currentUser();
    if (!user) throw new Error('Debe iniciar sesión antes de registrar la biometría.');
    if (!window.PublicKeyCredential || !navigator.credentials) {
      throw new Error('Este dispositivo/navegador no soporta WebAuthn.');
    }

    const options = await callFunction('webauthnStartRegistration', {
      uid: user.uid,
      rpId: window.location.hostname
    });

    const publicKey = {
      ...options,
      challenge: base64urlToUint8Array(options.challenge),
      user: { ...options.user, id: base64urlToUint8Array(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map(c => ({ ...c, id: base64urlToUint8Array(c.id) }))
    };

    const credential = await navigator.credentials.create({ publicKey });
    const response = webauthnToJSON(credential);
    const finish = await callFunction('webauthnFinishRegistration', {
      uid: user.uid,
      rpId: window.location.hostname,
      response
    });

    localStorage.setItem(`da_webauthn_credential_${user.uid}`, credential.id);
    await prepareWebAuthnChallenges(8);
    return finish;
  }

  async function prepareWebAuthnChallenges(count = 8) {
    const user = await currentUser();
    if (!user || !navigator.onLine) return 0;
    const data = await callFunction('webauthnPrepareChallenges', {
      uid: user.uid,
      rpId: window.location.hostname,
      count: Math.max(1, Math.min(Number(count) || 8, 20))
    });
    const actuales = JSON.parse(localStorage.getItem(`da_webauthn_challenges_${user.uid}`) || '[]');
    const nuevas = Array.isArray(data?.challenges) ? data.challenges : [];
    localStorage.setItem(`da_webauthn_challenges_${user.uid}`, JSON.stringify([...actuales, ...nuevas].slice(-30)));
    return nuevas.length;
  }

  async function authenticateWebAuthn() {
    const user = await currentUser();
    if (!user || !navigator.credentials || !window.PublicKeyCredential) {
      throw new Error('WebAuthn no está disponible en este dispositivo.');
    }

    let pool = JSON.parse(localStorage.getItem(`da_webauthn_challenges_${user.uid}`) || '[]');
    const credentialId = localStorage.getItem(`da_webauthn_credential_${user.uid}`) || '';
    if (!credentialId) throw new Error('Este dispositivo todavía no tiene una biometría registrada para este vigilador.');
    if (!pool.length && navigator.onLine) {
      await prepareWebAuthnChallenges(8);
      pool = JSON.parse(localStorage.getItem(`da_webauthn_challenges_${user.uid}`) || '[]');
    }
    const challenge = pool.find(x => !x.used);
    if (!challenge) throw new Error('No hay desafíos biométricos disponibles. Conéctese una vez para renovar la reserva de desafíos.');

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: base64urlToUint8Array(challenge.challenge),
        allowCredentials: [{ id: base64urlToUint8Array(credentialId), type: 'public-key' }],
        userVerification: 'required'
      }
    });

    challenge.used = true;
    localStorage.setItem(`da_webauthn_challenges_${user.uid}`, JSON.stringify(pool));

    return {
      challengeId: challenge.id,
      challenge: challenge.challenge,
      credentialId,
      assertion: webauthnToJSON(assertion)
    };
  }

  window.DAAuth = {
    init,
    currentUser,
    waitForAuth,
    roleOf,
    requireRole,
    signInWithEmail,
    signInLegajo,
    ensureVigilador,
    signOut,
    callFunction,
    authFetch,
    getIdToken,
    emailDeLegajo,
    normalizarLegajo,
    webauthnToJSON,
    webauthnFromJSON,
    base64urlToUint8Array,
    registerWebAuthn,
    prepareWebAuthnChallenges,
    authenticateWebAuthn,
    get firebase() { return firebaseApp; },
    get auth() { return auth; }
  };
})();
