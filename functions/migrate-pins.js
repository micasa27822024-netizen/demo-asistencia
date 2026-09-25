'use strict';

/*
 * Migración única de /personal con PIN a Firebase Authentication.
 * EJECUTAR SOLO EN ENTORNO CONTROLADO con credenciales de Admin SDK.
 * Después de la migración, el PIN se elimina de /personal.
 */
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.database();
const auth = admin.auth();

function normalizarLegajo(value) {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s.toUpperCase();
}

function generarTemporal() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function main() {
  const snap = await db.ref('personal').once('value');
  const data = snap.val() || {};
  const resumen = [];

  for (const [id, personal] of Object.entries(data)) {
    const legajo = normalizarLegajo(personal?.legajo);
    if (!legajo) continue;

    const pin = String(personal?.pin || personal?.clave || '').trim() || generarTemporal();
    const email = `${legajo}@demo.asistencia`;
    let user;

    try {
      user = await auth.getUser(legajo);
      user = await auth.updateUser(user.uid, { email, password: pin, displayName: personal.nombre || `Legajo ${legajo}` });
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        user = await auth.createUser({ uid: legajo, email, password: pin, displayName: personal.nombre || `Legajo ${legajo}` });
      } else {
        throw e;
      }
    }

    await auth.setCustomUserClaims(user.uid, { role: 'vigilador' });

    const update = {
      ...personal,
      legajo,
      authUid: user.uid,
      requiereCambioClave: true,
      authActualizadoEn: new Date().toISOString()
    };
    delete update.pin;
    delete update.clave;
    await db.ref(`personal/${id}`).set(update);

    resumen.push({ id, legajo, email, claveTemporal: pin });
  }

  console.log(JSON.stringify(resumen, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
