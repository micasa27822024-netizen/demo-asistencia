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

const vigApp  = initializeApp(firebaseConfig, "VigAuthApp");
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
    return { ok: true, idToken, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, razon: (e && e.code) || 'error' };
  }
}
window.loginVigilador = loginVigilador;

/** Cierra la sesion de Firebase Auth del vigilador. */
async function logoutVigilador() {
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
async function obtenerTokenVigilador(forzar) {
  try {
    if (vigAuth.currentUser) {
      const t = await vigAuth.currentUser.getIdToken(!!forzar);
      return t || null;
    }
  } catch (_) {}
  return null;
}
window.obtenerTokenVigilador = obtenerTokenVigilador;
