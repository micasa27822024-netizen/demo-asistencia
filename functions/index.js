'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

admin.initializeApp();
const db = admin.database();
const auth = admin.auth();

function requireRole(request, roles) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.');
  const role = request.auth.token?.role;
  if (!roles.includes(role)) throw new HttpsError('permission-denied', 'No tiene permisos para esta operación.');
  return role;
}

function normalizarLegajo(value) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, '');
  return text.toUpperCase();
}

function normalizeRP(rpId) {
  return String(rpId || '').trim().toLowerCase();
}

function expectedOriginFor(rpId) {
  if (rpId === 'localhost' || rpId === '127.0.0.1') return `http://${rpId}`;
  return `https://${rpId}`;
}

async function getPersonalByLegajo(legajo) {
  const snap = await db.ref('personal').orderByChild('legajo').equalTo(legajo).limitToFirst(1).once('value');
  const value = snap.val() || {};
  const first = Object.entries(value)[0];
  return first ? { id: first[0], ...first[1] } : null;
}

function objetivosIncluyen(personal, objectiveId) {
  const arr = personal?.objetivosAsignados;
  if (Array.isArray(arr)) {
    return arr.some(x => String(x?.id || x?.firebaseId || '') === String(objectiveId || ''));
  }
  if (arr && typeof arr === 'object') {
    return Object.entries(arr).some(([id, x]) => String(x?.id || id) === String(objectiveId || ''));
  }
  return false;
}

async function objetivoPermitido(personal, pending) {
  const objectiveId = String(pending?.objetivoAutorizadoId || '');
  if (!objectiveId) return false;
  if (objetivosIncluyen(personal, objectiveId)) return true;

  const fecha = String(pending?.fechaHoraDispositivo || '').slice(0, 10);
  const turnos = await db.ref('asignacionesTurnos')
    .orderByChild('legajo').equalTo(normalizarLegajo(personal.legajo))
    .once('value');

  const data = turnos.val() || {};
  return Object.values(data).some(t =>
    String(t?.fecha || '') === fecha &&
    String(t?.objetivoId || '') === objectiveId
  );
}

async function getAsistenciaConfig() {
  const snap = await db.ref('configuracionAsistencia').once('value');
  const data = snap.val() || {};
  const entrada = Number(data.toleranciaEntradaMinutos);
  const salida = Number(data.toleranciaSalidaMinutos);
  return {
    toleranciaEntradaMinutos: Number.isFinite(entrada) && entrada >= 0 ? Math.round(entrada) : 15,
    toleranciaSalidaMinutos: Number.isFinite(salida) && salida >= 0 ? Math.round(salida) : 30
  };
}

function partesFechaLocalArgentina(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  return formatted;
}

function minutosDesdeMedianoche(hora) {
  const m = String(hora || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function evaluarHorarioServidor(tipo, fechaEvento, horario, fechaBaseTurno, tolerancias) {
  const dt = new Date(fechaEvento);
  const inicioMin = minutosDesdeMedianoche(horario?.horaInicio);
  const finMin = minutosDesdeMedianoche(horario?.horaFin);
  if (!Number.isFinite(dt.getTime()) || inicioMin === null || finMin === null) {
    return { estado: 'SIN_HORARIO', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: 0 };
  }

  const localDate = fechaBaseTurno || partesFechaLocalArgentina(fechaEvento);
  if (!localDate) return { estado: 'SIN_HORARIO', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: 0 };

  const makeLocal = (date, mins) => {
    const sign = '-03:00';
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return new Date(`${date}T${hh}:${mm}:00${sign}`);
  };

  if (String(tipo).toUpperCase() === 'ENTRADA') {
    const inicio = makeLocal(localDate, inicioMin);
    const diff = Math.round((dt - inicio) / 60000);
    if (diff <= 0) return { estado: 'A_TIEMPO', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: 0 };
    if (diff <= tolerancias.toleranciaEntradaMinutos) return { estado: 'TARDANZA_TOLERANCIA', minutosTardanza: diff, minutosAnticipacion: 0, minutosExtra: 0 };
    return { estado: 'TARDANZA_ALERTA', minutosTardanza: diff, minutosAnticipacion: 0, minutosExtra: 0 };
  }

  const inicio = makeLocal(localDate, inicioMin);
  const finDate = finMin <= inicioMin ? new Date(inicio.getTime() + 24 * 60 * 60 * 1000) : makeLocal(localDate, finMin);
  const diffToFin = Math.round((dt - finDate) / 60000);
  const diffFromInicio = Math.round((dt - inicio) / 60000);
  if (diffFromInicio < 0) return { estado: 'NORMAL', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: 0 };
  if (diffToFin < 0) {
    const anticipacion = Math.abs(diffToFin);
    if (anticipacion <= tolerancias.toleranciaSalidaMinutos) return { estado: 'SALIDA_TOLERANCIA', minutosTardanza: 0, minutosAnticipacion: anticipacion, minutosExtra: 0 };
    return { estado: 'SALIDA_ANTICIPADA', minutosTardanza: 0, minutosAnticipacion: anticipacion, minutosExtra: 0 };
  }
  if (diffToFin <= tolerancias.toleranciaSalidaMinutos) return { estado: 'SALIDA_TOLERANCIA', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: 0 };
  return { estado: 'SALIDA_CON_EXTRA', minutosTardanza: 0, minutosAnticipacion: 0, minutosExtra: diffToFin };
}

async function obtenerHorarioServidor(personal, legajo, tipo, pending) {
  const fechaEntradaSalida = String(pending?.fechaHoraDispositivo || '').slice(0, 10);
  let baseTurno = fechaEntradaSalida;
  let asignacion = null;

  if (String(tipo).toUpperCase() === 'ENTRADA') {
    const turnosSnap = await db.ref('asignacionesTurnos')
      .orderByChild('legajo').equalTo(legajo).once('value');
    const data = turnosSnap.val() || {};
    const candidatos = Object.entries(data)
      .filter(([, t]) => String(t?.fecha || '') === fechaEntradaSalida)
      .sort((a, b) => String(a[1]?.horaInicio || '').localeCompare(String(b[1]?.horaInicio || '')));
    if (candidatos.length) {
      asignacion = { id: candidatos[0][0], ...candidatos[0][1] };
    }
  } else {
    const entradasSnap = await db.ref('fichadas')
      .orderByChild('legajo').equalTo(legajo).limitToLast(30).once('value');
    const registros = Object.values(entradasSnap.val() || {})
      .filter(f => String(f?.tipo || '').toUpperCase() === 'ENTRADA')
      .sort((a, b) => Number(b?.timestampServidor || 0) - Number(a?.timestampServidor || 0));
    const ultimaEntrada = registros[0];
    if (ultimaEntrada) {
      baseTurno = String(ultimaEntrada.fechaHoraDispositivo || ultimaEntrada.fechaHoraServidor || '').slice(0, 10) || fechaEntradaSalida;
      if (ultimaEntrada.horarioProgramadoInicio && ultimaEntrada.horarioProgramadoFin) {
        return {
          horaInicio: ultimaEntrada.horarioProgramadoInicio,
          horaFin: ultimaEntrada.horarioProgramadoFin,
          fechaBaseTurno: baseTurno,
          origen: 'ENTRADA_ACTIVA',
          asignacionTurnoId: ultimaEntrada.asignacionTurnoId || null,
          entradaActiva: ultimaEntrada
        };
      }
      const turnosSnap = await db.ref('asignacionesTurnos').orderByChild('legajo').equalTo(legajo).once('value');
      const data = turnosSnap.val() || {};
      const candidatos = Object.entries(data).filter(([, t]) => String(t?.fecha || '') === baseTurno);
      if (candidatos.length) asignacion = { id: candidatos[0][0], ...candidatos[0][1], entradaActiva: ultimaEntrada };
    }
  }

  if (asignacion?.horaInicio && asignacion?.horaFin) {
    return {
      horaInicio: String(asignacion.horaInicio),
      horaFin: String(asignacion.horaFin),
      fechaBaseTurno: baseTurno,
      origen: 'ASIGNACION_FECHA',
      asignacionTurnoId: asignacion.id || null,
      entradaActiva: asignacion?.entradaActiva || null
    };
  }

  const habitual = personal?.horarioHabitual || {};
  if (habitual.inicio && habitual.fin) {
    return {
      horaInicio: String(habitual.inicio),
      horaFin: String(habitual.fin),
      fechaBaseTurno: baseTurno,
      origen: 'HORARIO_HABITUAL',
      asignacionTurnoId: null,
      entradaActiva: null
    };
  }
  return null;
}

function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = n => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function verificarWebAuthnPendiente(pending) {
  const web = pending?.webAuthn;
  if (!web?.challengeId || !web?.assertion) return { ok: false, motivo: 'BIOMETRIA_AUSENTE' };
  const uid = normalizarLegajo(pending.legajo);
  const challengeRef = db.ref(`webAuthnChallenges/${uid}/${web.challengeId}`);
  const challengeSnap = await challengeRef.once('value');
  const challenge = challengeSnap.val();
  if (!challenge || challenge.used || challenge.expiresAt < Date.now()) return { ok: false, motivo: 'CHALLENGE_INVALIDO' };

  const credSnap = await db.ref(`credencialesWebAuthn/${uid}`).once('value');
  const credentials = Object.values(credSnap.val() || {});
  const response = web.assertion;
  const credential = credentials.find(c => c.id === String(response.id || web.credentialId || ''));
  if (!credential) return { ok: false, motivo: 'CREDENCIAL_NO_REGISTRADA' };

  const rpId = normalizeRP(web.rpId || challenge.rpId);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expectedOriginFor(rpId),
    expectedRPID: rpId,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey, 'base64'),
      counter: Number(credential.counter || 0),
      transports: credential.transports || []
    },
    requireUserVerification: true
  });
  if (!verification.verified) return { ok: false, motivo: 'FIRMA_BIOMETRICA_INVALIDA' };

  const newCounter = Number(verification.authenticationInfo?.newCounter || 0);
  const oldCounter = Number(credential.counter || 0);
  if (oldCounter > 0 && newCounter > 0 && newCounter <= oldCounter) return { ok: false, motivo: 'SIGNCOUNT_INVALIDO' };

  await db.ref(`credencialesWebAuthn/${uid}/${credential.id}/counter`).set(newCounter);
  await challengeRef.update({ used: true, usedAt: Date.now() });
  return { ok: true, signCount: newCounter, credentialId: credential.id };
}

async function validarServidorFichada(pending, pendingId) {
  const legajo = normalizarLegajo(pending?.legajo);
  const tipo = String(pending?.tipo || '').toUpperCase();
  const metodo = String(pending?.metodoIdentificacion || 'FOTO').toUpperCase();
  if (metodo === 'FOTO' && !pending?.fotoBase64) {
    return { ok: false, motivo: 'FOTO_AUSENTE' };
  }
  const fechaDispositivoMs = Date.parse(String(pending?.fechaHoraDispositivo || ''));
  const ahoraServidor = Date.now();
  if (!Number.isFinite(fechaDispositivoMs)) return { ok: false, motivo: 'FECHA_DISPOSITIVO_INVALIDA' };

  if (Math.abs(ahoraServidor - fechaDispositivoMs) > 48 * 60 * 60 * 1000) {
    return { ok: false, motivo: 'FECHA_DISPOSITIVO_FUERA_DE_RANGO' };
  }
  let webAuthnVerification = null;
  if (metodo === 'WEBAUTHN') {
    webAuthnVerification = await verificarWebAuthnPendiente(pending);
    if (!webAuthnVerification.ok) return { ok: false, motivo: webAuthnVerification.motivo };
  }
  const personal = await getPersonalByLegajo(legajo);

  if (!personal || String(personal.authUid || personal.legajo || '') !== legajo || String(personal.estado || 'ACTIVO').toUpperCase() !== 'ACTIVO') {
    return { ok: false, motivo: 'VIGILADOR_NO_VALIDO' };
  }

  if (!['ENTRADA', 'SALIDA'].includes(tipo)) return { ok: false, motivo: 'TIPO_INVALIDO' };

  const ultimosRegistrosSnap = await db.ref('fichadas')
    .orderByChild('legajo').equalTo(legajo).limitToLast(20).once('value');
  const ultimosRegistros = Object.entries(ultimosRegistrosSnap.val() || {})
    .map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => Number(b?.timestampServidor || 0) - Number(a?.timestampServidor || 0));
  const ultimaFichada = ultimosRegistros[0] || null;
  if (tipo === 'SALIDA' && String(ultimaFichada?.tipo || '').toUpperCase() !== 'ENTRADA') {
    return { ok: false, motivo: 'SIN_ENTRADA_ACTIVA' };
  }

  const objectiveId = String(pending.objetivoAutorizadoId || '');
  if (!(await objetivoPermitido(personal, pending))) {
    return { ok: false, motivo: 'OBJETIVO_NO_AUTORIZADO' };
  }

  const objetivoSnap = await db.ref(`objetivos/${objectiveId}`).once('value');
  const objetivo = objetivoSnap.val();
  if (!objetivo) return { ok: false, motivo: 'OBJETIVO_INEXISTENTE' };

  const lat = Number(pending.latitud);
  const lng = Number(pending.longitud);
  const latObj = Number(objetivo.latitud ?? objetivo.lat ?? objetivo.latitude);
  const lngObj = Number(objetivo.longitud ?? objetivo.lng ?? objetivo.lon ?? objetivo.longitude);
  const radio = Number(objetivo.radioPermitido ?? objetivo.radio ?? objetivo.radioMetros ?? 100);

  if (![lat, lng, latObj, lngObj].every(Number.isFinite)) {
    return { ok: false, motivo: 'GPS_INVALIDO' };
  }

  const distancia = distanciaMetros(lat, lng, latObj, lngObj);
  if (distancia > radio) {
    return {
      ok: false,
      motivo: 'FUERA_DE_GEOCERCA',
      distanciaMetros: Math.round(distancia),
      radioPermitido: Math.round(radio)
    };
  }

  const recientes = ultimosRegistros;
  const ahora = Date.now();
  const duplicado = recientes.some(f =>
    String(f?.tipo || '').toUpperCase() === tipo &&
    String(f?.objetivoAutorizadoId || '') === objectiveId &&
    Number(f?.timestampServidor || 0) > (ahora - 60000)
  );
  if (duplicado) return { ok: false, motivo: 'DUPLICADO_RECIENTE' };

  const horarioServidor = await obtenerHorarioServidor(personal, legajo, tipo, pending);
  if (!horarioServidor?.horaInicio || !horarioServidor?.horaFin) {
    return { ok: false, motivo: 'SIN_HORARIO_PROGRAMADO' };
  }
  const tolerancias = await getAsistenciaConfig();
  const evaluacion = evaluarHorarioServidor(
    tipo,
    new Date(fechaDispositivoMs),
    horarioServidor,
    horarioServidor.fechaBaseTurno,
    tolerancias
  );
  if (evaluacion.estado === 'SIN_HORARIO') return { ok: false, motivo: 'HORARIO_INVALIDO' };

  return {
    ok: true,
    legajo,
    tipo,
    personal,
    objetivo,
    distanciaMetros: Math.round(distancia),
    radioPermitido: Math.round(radio),
    timestampServidor: ahora,
    fechaHoraDispositivoMs: fechaDispositivoMs,
    horarioServidor,
    evaluacionHorarioServidor: evaluacion,
    tolerancias,
    pendingId: pendingId,
    webAuthnVerification
  };
}

exports.crearVigilador = onCall(async request => {
  requireRole(request, ['admin']);
  const data = request.data || {};
  const legajo = normalizarLegajo(data.legajo);
  const nombre = String(data.nombre || '').trim();
  const passwordTemporal = String(data.passwordTemporal || '');
  const fotoMaster = data.fotoMaster || null;

  if (!legajo || !nombre || !/^\d{4,8}$/.test(passwordTemporal)) {
    throw new HttpsError('invalid-argument', 'Legajo, nombre y clave temporal válidos son obligatorios.');
  }

  const email = `${legajo}@demo.asistencia`;
  let user;
  try {
    user = await auth.getUser(legajo);
    user = await auth.updateUser(user.uid, { email, password: passwordTemporal, displayName: nombre, disabled: false });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      user = await auth.createUser({ uid: legajo, email, password: passwordTemporal, displayName: nombre, disabled: false });
    } else {
      logger.error('crearVigilador/getUser', err);
      throw new HttpsError('internal', 'No se pudo crear/actualizar la cuenta de autenticación.');
    }
  }

  await auth.setCustomUserClaims(user.uid, { role: 'vigilador' });

  const existing = await getPersonalByLegajo(legajo);
  const payload = {
    legajo,
    authUid: user.uid,
    nombre,
    estado: 'ACTIVO',
    fotoMaster: fotoMaster || existing?.fotoMaster || null,
    horarioHabitual: existing?.horarioHabitual || { inicio: '', fin: '' },
    objetivosAsignados: existing?.objetivosAsignados || [],
    requiereCambioClave: true,
    authActualizadoEn: new Date().toISOString()
  };

  let personalId = existing?.id;
  if (!personalId) {
    personalId = db.ref('personal').push().key;
  }
  await db.ref(`personal/${personalId}`).set(payload);

  return { ok: true, uid: user.uid, email, personalId, passwordTemporal };
});

exports.eliminarVigilador = onCall(async request => {
  requireRole(request, ['admin']);
  const data = request.data || {};
  const personalId = String(data.personalId || '').trim();
  const legajo = normalizarLegajo(data.legajo || '');
  if (!personalId || !legajo) throw new HttpsError('invalid-argument', 'Personal y legajo son obligatorios.');

  const ref = db.ref(`personal/${personalId}`);
  const snap = await ref.once('value');
  const personal = snap.val();
  if (!personal) throw new HttpsError('not-found', 'No se encontró el registro de personal.');
  const authUid = normalizarLegajo(personal.authUid || personal.legajo || legajo);
  if (authUid !== legajo) throw new HttpsError('failed-precondition', 'La identidad de Firebase no coincide con el legajo.');

  try {
    await auth.deleteUser(authUid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      logger.error('eliminarVigilador/deleteUser', err);
      throw new HttpsError('internal', 'No se pudo eliminar la cuenta de autenticación.');
    }
  }

  await ref.remove();
  return { ok: true, mensaje: 'Registro de personal y cuenta de Firebase Authentication eliminados correctamente.' };
});

exports.validarFichadaPendiente = onValueCreated('/fichadasPendientes/{pendingId}', async event => {
  const pendingId = event.params.pendingId;
  const pending = event.data.val();
  if (!pending || String(pending.estadoServidor || '').toUpperCase() === 'PROCESADA') return;

  const result = await validarServidorFichada(pending, pendingId);
  if (!result.ok) {
    await db.ref(`fichadasPendientes/${pendingId}`).update({
      estadoServidor: 'RECHAZADA',
      motivoServidor: result.motivo,
      procesadoEn: Date.now()
    });
    return;
  }

  const { webAuthn, ...pendingSinAssertion } = pending;
  const finalData = {
    ...pendingSinAssertion,
    legajo: result.legajo,
    authUid: result.legajo,
    nombre: result.personal.nombre || pending.nombre || `Legajo ${result.legajo}`,
    objetivo: pending.objetivo || result.objetivo.nombre || result.objetivo.codigo || '',
    estadoServidor: 'VALIDADA',
    validacionServidor: 'OK',
    distanciaServidorMetros: result.distanciaMetros,
    radioPermitidoMetros: result.radioPermitido,
    timestampServidor: result.timestampServidor,
    fechaHoraServidor: new Date(result.timestampServidor).toISOString(),
    fechaEventoValidado: new Date(result.fechaHoraDispositivoMs).toISOString(),
    horarioProgramadoInicio: result.horarioServidor.horaInicio,
    horarioProgramadoFin: result.horarioServidor.horaFin,
    horarioProgramadoOrigen: result.horarioServidor.origen,
    asignacionTurnoId: result.horarioServidor.asignacionTurnoId || pending.asignacionTurnoId || null,
    estadoHorario: result.evaluacionHorarioServidor.estado,
    minutosTardanza: result.evaluacionHorarioServidor.minutosTardanza,
    minutosAnticipacion: result.evaluacionHorarioServidor.minutosAnticipacion,
    minutosExtra: result.evaluacionHorarioServidor.minutosExtra,
    toleranciaEntradaMinutos: result.tolerancias.toleranciaEntradaMinutos,
    toleranciaSalidaMinutos: result.tolerancias.toleranciaSalidaMinutos,
    fichadaPendienteId: pendingId,
    biometriaServidor: result.webAuthnVerification?.ok ? {
      validada: true,
      credentialId: result.webAuthnVerification.credentialId,
      signCount: result.webAuthnVerification.signCount
    } : null
  };

  await db.ref(`fichadas/${pendingId}`).set(finalData);
  await db.ref(`fichadasPendientes/${pendingId}`).update({
    estadoServidor: 'APROBADA',
    procesadoEn: result.timestampServidor
  });

  if (String(finalData.tipo).toUpperCase() === 'ENTRADA' && String(finalData.estadoHorario || '') === 'TARDANZA_ALERTA') {
    const key = db.ref('alertasFichadas').push().key;
    await db.ref(`alertasFichadas/${key}`).set({
      tipoAlerta: 'FICHADA_TARDIA_ENTRADA',
      legajo: result.legajo,
      nombre: finalData.nombre,
      objetivo: finalData.objetivo,
      fechaHora: finalData.fechaHoraServidor,
      minutosTardanza: Number(finalData.minutosTardanza || 0),
      firebaseFichadaId: pendingId,
      fuenteAlerta: 'servidor',
      vistoAdmin: false,
      vistoSupervisor: false
    });
  }

  if (String(finalData.tipo).toUpperCase() === 'SALIDA' && String(finalData.estadoHorario || '') === 'SALIDA_ANTICIPADA') {
    const entrada = result.horarioServidor.entradaActiva || null;
    const entradaFecha = entrada?.fechaHoraDispositivo || entrada?.fechaHoraServidor || null;
    const salidaFecha = finalData.fechaHoraDispositivo || finalData.fechaHoraServidor;
    const key = db.ref('alertasSalidasAnticipadas').push().key;
    await db.ref(`alertasSalidasAnticipadas/${key}`).set({
      tipoAlerta: 'SALIDA_ANTICIPADA',
      estado: 'NUEVA',
      legajo: result.legajo,
      nombre: finalData.nombre,
      objetivo: finalData.objetivo,
      fechaHoraEntrada: entradaFecha,
      fechaHoraSalida: salidaFecha,
      fechaHora: salidaFecha,
      horaFinProgramada: finalData.horarioProgramadoFin || '',
      minutosAnticipacion: Number(finalData.minutosAnticipacion || 0),
      horario: { inicio: finalData.horarioProgramadoInicio || '', fin: finalData.horarioProgramadoFin || '' },
      entrada: [entradaFecha, result.legajo, finalData.nombre, entrada?.objetivo || finalData.objetivo, 'ENTRADA'],
      salida: [salidaFecha, result.legajo, finalData.nombre, finalData.objetivo, 'SALIDA'],
      firebaseFichadaId: pendingId,
      fuenteAlerta: 'servidor',
      vistoAdmin: false,
      vistoSupervisor: false
    });
  }
});

exports.procesarAlertaFichadaPendiente = onValueCreated('/alertasFichadasPendientes/{alertaId}', async event => {
  const alertaId = event.params.alertaId;
  const alerta = event.data.val();
  if (!alerta || String(alerta.estadoServidor || '').toUpperCase() === 'PROCESADA') return;

  const legajo = normalizarLegajo(alerta.legajo);
  const personal = await getPersonalByLegajo(legajo);
  if (!personal || personal.authUid !== legajo || String(personal.estado || 'ACTIVO').toUpperCase() !== 'ACTIVO') {
    await db.ref(`alertasFichadasPendientes/${alertaId}`).update({ estadoServidor: 'RECHAZADA', motivoServidor: 'VIGILADOR_NO_VALIDO', procesadoEn: Date.now() });
    return;
  }
  if (String(alerta.authUid || '') !== legajo) {
    await db.ref(`alertasFichadasPendientes/${alertaId}`).update({ estadoServidor: 'RECHAZADA', motivoServidor: 'IDENTIDAD_INVALIDA', procesadoEn: Date.now() });
    return;
  }

  const key = db.ref('alertasFichadas').push().key;
  await db.ref(`alertasFichadas/${key}`).set({
    ...alerta,
    legajo,
    authUid: legajo,
    fuenteAlerta: 'servidor',
    estado: 'NUEVA',
    vistoAdmin: false,
    vistoSupervisor: false,
    timestampServidor: Date.now(),
    alertaPendienteId: alertaId
  });

  await db.ref(`alertasFichadasPendientes/${alertaId}`).update({
    estadoServidor: 'APROBADA',
    procesadoEn: Date.now()
  });
});

exports.registrarAuditoriaCambios = onValueWritten('/personal/{resourceId}', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: `personal/${event.params.resourceId}`,
    accion: !before && after ? 'CREAR' : before && !after ? 'ELIMINAR' : 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function',
    legajo: after?.legajo || before?.legajo || null
  });
});

exports.registrarAuditoriaObjetivos = onValueWritten('/objetivos/{resourceId}', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: `objetivos/${event.params.resourceId}`,
    accion: !before && after ? 'CREAR' : before && !after ? 'ELIMINAR' : 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function'
  });
});

exports.registrarAuditoriaTurnos = onValueWritten('/asignacionesTurnos/{resourceId}', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: `asignacionesTurnos/${event.params.resourceId}`,
    accion: !before && after ? 'CREAR' : before && !after ? 'ELIMINAR' : 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function',
    legajo: after?.legajo || before?.legajo || null
  });
});

exports.registrarAuditoriaConfiguracionAsistencia = onValueWritten('/configuracionAsistencia', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: 'configuracionAsistencia',
    accion: 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function'
  });
});

exports.registrarAuditoriaConfiguracionEmpresa = onValueWritten('/configuracionEmpresa', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: 'configuracionEmpresa',
    accion: 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function'
  });
});

exports.registrarAuditoriaEliminacionesAlertas = onValueWritten('/alertasFichadasEliminadas/{resourceId}', async event => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = db.ref('auditoria').push().key;
  await db.ref(`auditoria/${key}`).set({
    recurso: `alertasFichadasEliminadas/${event.params.resourceId}`,
    accion: !before && after ? 'REGISTRAR_ELIMINACION' : 'MODIFICAR',
    timestamp: Date.now(),
    usuarioBackend: 'firebase-function'
  });
});

exports.webauthnStartRegistration = onCall(async request => {
  requireRole(request, ['vigilador', 'admin']);
  const { uid, rpId } = request.data || {};
  if (request.auth.uid !== uid && request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'No puede registrar credenciales para otro usuario.');
  const normalizedRpId = normalizeRP(rpId || '');
  if (!normalizedRpId) throw new HttpsError('invalid-argument', 'rpId requerido.');

  const existingSnap = await db.ref(`credencialesWebAuthn/${uid}`).once('value');
  const existing = existingSnap.val() || {};
  const excludeCredentials = Object.values(existing).map(c => ({ id: c.id, transports: c.transports || [] }));

  const user = await auth.getUser(uid);
  const options = await generateRegistrationOptions({
    rpName: 'Demo Asistencia',
    rpID: normalizedRpId,
    userID: Buffer.from(uid),
    userName: user.email || `${uid}@demo.asistencia`,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required'
    }
  });

  await db.ref(`webAuthnRegistrationChallenges/${uid}`).set({
    challenge: options.challenge,
    rpId: normalizedRpId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  return options;
});

exports.webauthnFinishRegistration = onCall(async request => {
  requireRole(request, ['vigilador', 'admin']);
  const { uid, rpId, response } = request.data || {};
  if (request.auth.uid !== uid && request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'No puede registrar credenciales para otro usuario.');
  const challengeSnap = await db.ref(`webAuthnRegistrationChallenges/${uid}`).once('value');
  const challengeData = challengeSnap.val();
  if (!challengeData || challengeData.expiresAt < Date.now()) throw new HttpsError('failed-precondition', 'El desafío de registro venció.');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: expectedOriginFor(normalizeRP(rpId)),
    expectedRPID: normalizeRP(rpId),
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) throw new HttpsError('permission-denied', 'No se pudo verificar la credencial biométrica.');

  const info = verification.registrationInfo;
  const credential = {
    id: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64'),
    counter: info.credential.counter,
    transports: response?.response?.transports || [],
    createdAt: Date.now(),
    rpId: normalizeRP(rpId)
  };
  await db.ref(`credencialesWebAuthn/${uid}/${credential.id}`).set(credential);
  await db.ref(`webAuthnRegistrationChallenges/${uid}`).remove();

  return { ok: true, credentialId: credential.id };
});

exports.webauthnPrepareChallenges = onCall(async request => {
  requireRole(request, ['vigilador', 'admin']);
  const { uid, rpId, count } = request.data || {};
  if (request.auth.uid !== uid && request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'No puede generar desafíos para otro usuario.');
  const normalizedRpId = normalizeRP(rpId);
  const credSnap = await db.ref(`credencialesWebAuthn/${uid}`).once('value');
  const creds = Object.values(credSnap.val() || {});
  if (!creds.length) throw new HttpsError('failed-precondition', 'No existe una credencial WebAuthn registrada.');
  const n = Math.max(1, Math.min(Number(count) || 8, 20));
  const output = [];

  for (let i = 0; i < n; i++) {
    const options = await generateAuthenticationOptions({
      rpID: normalizedRpId,
      allowCredentials: creds.map(c => ({ id: c.id, transports: c.transports || [] })),
      userVerification: 'required'
    });
    const id = db.ref(`webAuthnChallenges/${uid}`).push().key;
    await db.ref(`webAuthnChallenges/${uid}/${id}`).set({
      challenge: options.challenge,
      rpId: normalizedRpId,
      used: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    output.push({ id, challenge: options.challenge, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  }
  return { challenges: output };
});

exports.verificarAssertionWebAuthn = onCall(async request => {
  requireRole(request, ['vigilador']);
  const data = request.data || {};
  const uid = request.auth.uid;
  const challengeId = String(data.challengeId || '');
  const rpId = normalizeRP(data.rpId || '');
  const response = data.response;
  if (!challengeId || !response || !rpId) throw new HttpsError('invalid-argument', 'Datos WebAuthn incompletos.');

  const challengeRef = db.ref(`webAuthnChallenges/${uid}/${challengeId}`);
  const challengeSnap = await challengeRef.once('value');
  const challenge = challengeSnap.val();
  if (!challenge || challenge.used || challenge.expiresAt < Date.now()) throw new HttpsError('failed-precondition', 'El desafío biométrico ya no es válido.');

  const credSnap = await db.ref(`credencialesWebAuthn/${uid}`).once('value');
  const credentials = Object.values(credSnap.val() || {});
  const credential = credentials.find(c => c.id === String(response.id || ''));
  if (!credential) throw new HttpsError('permission-denied', 'Credencial WebAuthn desconocida.');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: expectedOriginFor(rpId),
    expectedRPID: rpId,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey, 'base64'),
      counter: Number(credential.counter || 0),
      transports: credential.transports || []
    },
    requireUserVerification: true
  });

  if (!verification.verified) throw new HttpsError('permission-denied', 'La firma biométrica no pudo ser verificada.');

  const newCounter = Number(verification.authenticationInfo?.newCounter || 0);
  const oldCounter = Number(credential.counter || 0);
  if (oldCounter > 0 && newCounter > 0 && newCounter <= oldCounter) {
    throw new HttpsError('permission-denied', 'Contador WebAuthn no válido.');
  }

  await db.ref(`credencialesWebAuthn/${uid}/${credential.id}/counter`).set(newCounter);
  await challengeRef.update({ used: true, usedAt: Date.now() });
  return { ok: true, signCount: newCounter };
});

exports.crearPrimerAdmin = onRequest(async (req, res) => {
  const email = "admin@demo.asistencia";
  const password = "AdminPassword123!";

  try {
    let user;
    try {
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password: password });
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        user = await auth.createUser({
          email: email,
          password: password,
          displayName: "Super Admin"
        });
      } else {
        throw e;
      }
    }

    await auth.setCustomUserClaims(user.uid, { role: 'admin' });

    res.status(200).send({
      ok: true,
      mensaje: "Administrador inicial configurado correctamente.",
      uid: user.uid,
      email: email
    });
  } catch (err) {
    logger.error("crearPrimerAdmin", err);
    res.status(500).send({ ok: false, error: err.message });
  }
});
