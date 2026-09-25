/* Demo Asistencia - configuración y autenticación común.
 * IMPORTANTE: la apiKey/appId son valores públicos de configuración de Firebase,
 * no sustituyen a las Firebase Security Rules ni contienen secretos privados.
 */
(function () {
  'use strict';

  const FIREBASE_SDK_MIN = '10.12.5';
  let config = null;
  let app = null;
  let auth = null;
  let db = null;
  let functions = null;
  let company = null;
  let initialized = false;
  let initializationPromise = null;

  function normalizeLegajo(value) {
    return String(value ?? '').trim().replace(/\s+/g, '');
  }

  const EMBEDDED_COMPANIES = {
    default: {
      id: 'demo-asistencia',
      nombre: 'Demo Asistencia S.A.',
      dominios: ['micasa27822024-netizen.github.io'],
      firebase: {
        apiKey: 'AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo',
        authDomain: 'fir-asistencia-fad12.firebaseapp.com',
        databaseURL: 'https://fir-asistencia-fad12-default-rtdb.firebaseio.com',
        projectId: 'fir-asistencia-fad12',
        storageBucket: 'fir-asistencia-fad12.firebasestorage.app',
        messagingSenderId: '441100861030',
        appId: '1:441100861030:web:b4287e1c3a377cf892b7a7'
      },
      metodoIdentificacion: 'FOTO',
      admins: ['micasa27822024@gmail.com']
    }
  };

  async function loadCompanyConfig() {
    if (window.DEMO_ASISTENCIA_FIREBASE_CONFIG) {
      return { firebase: window.DEMO_ASISTENCIA_FIREBASE_CONFIG };
    }

    let all = null;
    try {
      const response = await fetch('./companies.json', { cache: 'no-store' });
      if (response.ok) all = await response.json();
    } catch (_) {
      // Permite abrir la plataforma desde file:// usando la configuración embebida.
    }
    all = all || EMBEDDED_COMPANIES;
    const hostname = String(window.location.hostname || '').toLowerCase();

    let selected = null;
    for (const value of Object.values(all || {})) {
      if (!value) continue;
      const domains = Array.isArray(value.dominios) ? value.dominios : [];
      if (domains.some(d => String(d || '').toLowerCase() === hostname)) {
        selected = value;
        break;
      }
    }
    selected = selected || all.default || Object.values(all || {})[0];
    if (!selected || !selected.firebase) {
      throw new Error('companies.json no contiene una configuración Firebase válida.');
    }

    return selected;
  }

  function validateFirebaseConfig(cfg) {
    const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
    const missing = required.filter(k => !cfg || !cfg[k] || String(cfg[k]).startsWith('REEMPLAZAR_'));
    if (missing.length) {
      throw new Error('Falta completar en companies.json: ' + missing.join(', ') + '.');
    }
  }

  async function init() {
    if (initialized) return { config, company, app, auth, db, functions };
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      if (!window.firebase) throw new Error('El SDK de Firebase no fue cargado.');
      company = await loadCompanyConfig();
      config = company.firebase || company;
      validateFirebaseConfig(config);

      app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
      auth = firebase.auth(app);
      db = firebase.database(app);
      functions = firebase.functions(app);
      initialized = true;
      return { config, company, app, auth, db, functions };
    })();

    try {
      return await initializationPromise;
    } catch (error) {
      initializationPromise = null;
      throw error;
    }
  }

  async function currentUser() {
    await init();
    return auth.currentUser;
  }

  async function signInWithEmail(email, password) {
    await init();
    return auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  }

  async function signOut() {
    if (!auth) await init();
    return auth.signOut();
  }

  async function roleOf(user) {
    if (!user) return null;
    const token = await user.getIdTokenResult(true);
    return token.claims?.role || token.claims?.rol || null;
  }

  async function requireRole(role) {
    const user = await currentUser();
    if (!user) throw new Error('No hay una sesión autenticada.');
    const currentRole = await roleOf(user);
    if (currentRole !== role) throw new Error('La cuenta no tiene el rol requerido: ' + role + '.');
    return user;
  }

  async function waitForAuthReady() {
    await init();
    if (auth.currentUser) return auth.currentUser;
    return new Promise(resolve => {
      let unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      });
    });
  }

  async function callFunction(name, data) {
    await init();
    const callable = functions.httpsCallable(name);
    const result = await callable(data || {});
    return result.data;
  }

  async function ensureVigilador(legajo, pin) {
    await init();
    const normalized = normalizeLegajo(legajo);
    if (!normalized) throw new Error('Legajo requerido.');
    if (!pin) throw new Error('PIN requerido.');
    return signInWithEmail(normalized + '@demo.asistencia', pin);
  }

  function getPublicKeyCredentialOptionsBase64(options) {
    return options;
  }

  async function registerWebAuthn() {
    const user = await currentUser();
    if (!user) throw new Error('Debe existir una sesión autenticada para registrar el dispositivo.');
    const options = await callFunction('webAuthnBeginRegistration', {});
    const publicKey = getPublicKeyCredentialOptionsBase64(options.options || options);
    if (!publicKey?.challenge) throw new Error('El servidor no devolvió un challenge WebAuthn válido.');

    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new Error('No se pudo registrar la credencial WebAuthn.');

    const rawId = new Uint8Array(credential.rawId);
    const response = credential.response;
    const result = await callFunction('webAuthnFinishRegistration', {
      id: credential.id,
      rawId: btoa(String.fromCharCode(...rawId)),
      type: credential.type,
      response: {
        clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
        attestationObject: btoa(String.fromCharCode(...new Uint8Array(response.attestationObject))),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : []
      }
    });
    return result;
  }

  function base64UrlToUint8Array(base64url) {
    const base64 = String(base64url).replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob(base64 + pad);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function prepareWebAuthnChallenges(quantity) {
    return callFunction('prepareWebAuthnChallenges', { quantity: Math.max(1, Math.min(Number(quantity) || 8, 20)) });
  }

  async function authenticateWebAuthn() {
    const options = await callFunction('webAuthnBeginAuthentication', {});
    const publicKey = options.options || options;
    if (!publicKey || !publicKey.challenge) throw new Error('No hay challenge WebAuthn disponible.');
    publicKey.challenge = base64UrlToUint8Array(publicKey.challenge);
    if (Array.isArray(publicKey.allowCredentials)) {
      publicKey.allowCredentials = publicKey.allowCredentials.map(item => ({
        ...item,
        id: base64UrlToUint8Array(item.id)
      }));
    }
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) throw new Error('No se obtuvo una autenticación WebAuthn.');

    const response = credential.response;
    const assertion = {
      id: credential.id,
      rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
      type: credential.type,
      response: {
        clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
        authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))),
        signature: btoa(String.fromCharCode(...new Uint8Array(response.signature))),
        userHandle: response.userHandle ? btoa(String.fromCharCode(...new Uint8Array(response.userHandle))) : null
      }
    };
    return await callFunction('webAuthnFinishAuthentication', assertion);
  }

  window.DAConfig = {
    get company() { return company; },
    get firebase() { return config; },
    get app() { return app; },
    get auth() { return auth; },
    get db() { return db; },
    get functions() { return functions; },
    FIREBASE_SDK_MIN
  };

  window.DAAuth = {
    init,
    currentUser,
    signInWithEmail,
    signOut,
    roleOf,
    requireRole,
    waitForAuthReady,
    callFunction,
    ensureVigilador,
    registerWebAuthn,
    prepareWebAuthnChallenges,
    authenticateWebAuthn,
    normalizarLegajo: normalizeLegajo,
    normalizeLegajo
  };
})();
