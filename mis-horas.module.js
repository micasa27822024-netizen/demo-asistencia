import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
// [AppCheck] SDK de App Check: valida que el cliente es TU app (atestacion de origen).
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo",
  authDomain: "fir-asistencia-fad12.firebaseapp.com",
  databaseURL: "https://fir-asistencia-fad12-default-rtdb.firebaseio.com",
  projectId: "fir-asistencia-fad12",
  storageBucket: "fir-asistencia-fad12.firebasestorage.app",
  messagingSenderId: "441100861030",
  appId: "1:441100861030:web:b4287e1c3a377cf892b7a7"
};

const vigApp  = initializeApp(firebaseConfig, "VigAuthApp");
// [AppCheck] Clave de SITIO de reCAPTCHA ENTERPRISE (es PUBLICA: va en el frontend).
// La generas en Google Cloud -> Seguridad -> reCAPTCHA Enterprise (clave de
// tipo "sitio web", basada en puntuacion). REEMPLAZA el valor ANTES de publicar.
const RECAPTCHA_SITE_KEY = "6LdhL9wtAAAAADsplK8-j2CIS3Oa-vFCBjdUoSZL";
// Solo en localhost: habilita el token de depuracion de App Check (en
// produccion/GitHub Pages NO se activa). El token sale en la consola del
// navegador y debes registrarlo en Firebase -> App Check -> "Depuracion".
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
// [AppCheck] Arranca la atestacion de origen para esta instancia de Firebase.
try {
  initializeAppCheck(vigApp, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
} catch (e) { console.warn("App Check no se pudo iniciar:", e); }
const vigAuth = getAuth(vigApp);

/**
 * Inicia sesion REAL del vigilador (legajo + PIN) manteniendo la sesion en
 * Firebase Auth y devolviendo su idToken para autorizar las lecturas
 * (?auth=). Mantiene la sesion viva (no la cierra):
 * la mantiene viva durante la consulta de horas.
 * Persistencia de sesion (no sobrevive al cierre de pestana).
 * @returns {Promise<{ok:boolean, idToken?:string, uid?:string, razon?:string}>}
 */
async function loginVigilador(legajo, pin) {
  const legajoLimpio = String(legajo || '').trim();
  const pinLimpio    = String(pin || '').trim();
  if (!legajoLimpio || !pinLimpio) return { ok: false, razon: 'faltan_datos' };

  const email    = `${legajoLimpio}@demo.asistencia`;
  const password = pinLimpio.padStart(6, '0');
  try {
    try { await setPersistence(vigAuth, browserSessionPersistence); } catch (_) {}
    const cred = await signInWithEmailAndPassword(vigAuth, email, password);
    const idToken = await cred.user.getIdToken();
    _tokenTimestamp = Date.now();
    _iniciarRenovacionToken();
    return { ok: true, idToken, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, razon: (e && e.code) || 'error' };
  }
}
window.loginVigilador = loginVigilador;

/** Cierra la sesion de Firebase Auth del vigilador. */
async function logoutVigilador() {
  _detenerRenovacionToken();
  try { await signOut(vigAuth); } catch (_) {}
}
window.logoutVigilador = logoutVigilador;

/**
 * Devuelve un idToken VIGENTE del vigilador logueado. El SDK refresca el
 * token automaticamente si esta vencido o proximo a vencer; con forzar=true
 * se pide uno nuevo si o si. Critico para el boton de panico en turnos
 * largos (el token cacheado al loguear caduca ~1h).
 * @returns {Promise<string|null>}
 */
// ─────────────────────────────────────────────────────────────────────────────
//  RENOVACIÓN AUTOMÁTICA DEL TOKEN (igual que admin/panel/index)
//  Cada 50 min se renueva proactivamente; obtenerTokenVigilador refresca
//  automáticamente si el token tiene >50 min de antigüedad.
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_MAX_ANTIGUEDAD_MS = 50 * 60 * 1000;
let _tokenTimestamp = 0;
let _tokenRefreshing = null;

async function _forzarRefreshToken() {
  if (_tokenRefreshing) return _tokenRefreshing;
  _tokenRefreshing = (async () => {
    try {
      if (vigAuth.currentUser) {
        const t = await vigAuth.currentUser.getIdToken(true);
        _tokenTimestamp = Date.now();
        return t;
      }
    } catch (e) {
      console.warn('[Token Mis-Horas] Error al renovar:', e && (e.code || e.message));
      _tokenTimestamp = 0;
    } finally {
      _tokenRefreshing = null;
    }
    return null;
  })();
  return _tokenRefreshing;
}

let _timerRenovacion = null;
function _iniciarRenovacionToken() {
  if (_timerRenovacion) return;
  _timerRenovacion = setInterval(() => {
    if (vigAuth.currentUser) {
      _forzarRefreshToken().catch(() => {});
    } else {
      clearInterval(_timerRenovacion);
      _timerRenovacion = null;
    }
  }, TOKEN_MAX_ANTIGUEDAD_MS);
}
function _detenerRenovacionToken() {
  if (_timerRenovacion) { clearInterval(_timerRenovacion); _timerRenovacion = null; }
}

async function obtenerTokenVigilador(forzar = false) {
  try {
    if (!vigAuth.currentUser) return null;
    if (forzar || Date.now() - _tokenTimestamp > TOKEN_MAX_ANTIGUEDAD_MS) {
      const fresco = await _forzarRefreshToken();
      if (fresco) return fresco;
    }
    const cacheado = await vigAuth.currentUser.getIdToken();
    return cacheado || null;
  } catch (_) { return null; }
}

window.obtenerTokenVigilador = obtenerTokenVigilador;
window._forzarRefreshTokenMisHoras = _forzarRefreshToken;
window._iniciarRenovacionToken = _iniciarRenovacionToken;
window._detenerRenovacionToken = _detenerRenovacionToken;
