/* =========================================================================
   LICENCIA.JS - Control de licencia de prueba (vencimiento por fecha)
   -------------------------------------------------------------------------
   >>> UNICO LUGAR QUE TENES QUE TOCAR PARA CAMBIAR LA PRUEBA <<<
   Cambia SOLO los valores de abajo (cliente, vence, modo, contacto).
   El resto del archivo es la logica: no hace falta tocarla.
   ========================================================================= */

window.LICENCIA = {
  // Nombre del cliente / de esta copia. Aparece en el cartel de vencimiento.
  cliente: "Demo Asistencia",

  // Fecha y hora EXACTA en que vence la prueba (hora de Argentina, -03:00).
  // Formato:  "AAAA-MM-DDTHH:MM:SS-03:00"
  // Ejemplo de abajo: vence el 16 de octubre de 2026 a las 23:59.
  // Para dar mas dias, solo cambia la fecha (ej: "2026-11-30T23:59:59-03:00").
  vence: "2026-10-16T23:59:59-03:00",

  // Que hacer cuando vence:
  //   "bloquear"     -> tapa la pantalla, no se puede usar nada (recomendado para demos).
  //   "solo-lectura" -> deja ver, pero DESHABILITA todos los botones (no se puede fichar/guardar).
  modo: "bloquear",

  // Cuantos dias antes del vencimiento el contador se pone en color de alerta.
  avisarDiasAntes: 3,

  // Texto de contacto que se muestra cuando vence (telefono, mail, lo que quieras).
  contacto: "Contactate con el proveedor para renovar el acceso.",

  // Mostrar el contador regresivo siempre visible (true) o no (false).
  mostrarContador: true
};

/* ========================= LOGICA (no editar) ============================ */
(function () {
  var L = window.LICENCIA || {};
  var venceMs = Date.parse(L.vence);
  if (!venceMs || isNaN(venceMs)) return; // Sin fecha valida: no hace nada.

  var MS_DIA = 86400000;
  var bloqueado = false;

  // Desfase entre la hora del servidor y la del dispositivo (ms).
  // Se fija una vez con el servidor y se usa para que el contador sea fiel
  // aunque muevan el reloj del telefono/compu a mano.
  var offsetServidorMs = 0;

  function ahora() { return Date.now() + offsetServidorMs; }
  function diasRestantes(t) { return Math.ceil((venceMs - t) / MS_DIA); }

  // Hora oficial del SERVIDOR (header Date de la respuesta HTTP). Resistente a
  // que cambien el reloj local. Si falla (sin conexion), devuelve null.
  function horaServidor() {
    return fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) {
        var d = r.headers.get('date');
        if (d) { var t = Date.parse(d); if (!isNaN(t)) return t; }
        return null;
      })
      .catch(function () { return null; });
  }

  // ---- Fecha legible: "16/10/2026 23:59" ----
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function fechaLegible(ms) {
    var f = new Date(ms);
    return dos(f.getDate()) + '/' + dos(f.getMonth() + 1) + '/' + f.getFullYear() +
           ' ' + dos(f.getHours()) + ':' + dos(f.getMinutes());
  }
  // ---- Cuenta regresiva: "12d 05:30:21" ----
  function restanteTexto(ms) {
    if (ms < 0) ms = 0;
    var seg = Math.floor(ms / 1000);
    var d = Math.floor(seg / 86400); seg -= d * 86400;
    var h = Math.floor(seg / 3600);  seg -= h * 3600;
    var m = Math.floor(seg / 60);    seg -= m * 60;
    return d + 'd ' + dos(h) + ':' + dos(m) + ':' + dos(seg);
  }

  // ===================== CONTADOR SIEMPRE VISIBLE =====================
  var elContador = null, elReloj = null, tick = null;

  function crearContador() {
    if (!L.mostrarContador || document.getElementById('licenciaContador')) return;
    var box = document.createElement('div');
    box.id = 'licenciaContador';
    var s = box.style;
    s.position = 'fixed'; s.right = '12px'; s.bottom = '12px';
    s.zIndex = '2147483645';
    s.background = 'rgba(15,23,42,0.95)';
    s.border = '1px solid #334155'; s.borderRadius = '12px';
    s.padding = '8px 12px'; s.minWidth = '150px';
    s.boxShadow = '0 8px 24px rgba(0,0,0,0.45)';
    s.font = '600 11px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    s.color = '#cbd5e1'; s.textAlign = 'center'; s.pointerEvents = 'none';
    s.lineHeight = '1.35';

    var t1 = document.createElement('div');
    t1.textContent = 'VERSION DE PRUEBA';
    t1.style.fontSize = '9px'; t1.style.letterSpacing = '1px';
    t1.style.color = '#34d399'; t1.style.fontWeight = '700';

    var t2 = document.createElement('div');
    t2.textContent = 'Vence: ' + fechaLegible(venceMs);
    t2.style.color = '#94a3b8'; t2.style.marginTop = '2px';

    elReloj = document.createElement('div');
    elReloj.style.fontSize = '16px'; elReloj.style.fontWeight = '800';
    elReloj.style.marginTop = '3px'; elReloj.style.color = '#f8fafc';
    elReloj.style.fontVariantNumeric = 'tabular-nums';

    box.appendChild(t1); box.appendChild(t2); box.appendChild(elReloj);
    (document.body || document.documentElement).appendChild(box);
    elContador = box;
    actualizarContador();
  }

  function actualizarContador() {
    var falta = venceMs - ahora();
    if (falta <= 0) {
      if (elReloj) elReloj.textContent = 'VENCIDA';
      ocultarContador();
      aplicarVencimiento();
      return;
    }
    if (elReloj) {
      elReloj.textContent = restanteTexto(falta);
      var d = diasRestantes(ahora());
      var col = (d <= 1) ? '#f87171' : (d <= (L.avisarDiasAntes || 0)) ? '#fbbf24' : '#f8fafc';
      elReloj.style.color = col;
      if (elContador) {
        elContador.style.borderColor = (d <= 1) ? '#7f1d1d'
                                     : (d <= (L.avisarDiasAntes || 0)) ? '#78350f' : '#334155';
      }
    }
  }

  function ocultarContador() {
    if (tick) { clearInterval(tick); tick = null; }
    if (elContador) { elContador.remove(); elContador = null; }
  }

  // ---- Cartel de bloqueo (pantalla completa) ----
  function modoBloqueo() {
    if (document.getElementById('licenciaOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'licenciaOverlay';
    var s = ov.style;
    s.position = 'fixed'; s.top = '0'; s.left = '0'; s.right = '0'; s.bottom = '0';
    s.zIndex = '2147483647';
    s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center';
    s.padding = '24px';
    s.background = 'rgba(2,6,23,0.97)';
    s.fontFamily = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    var card = document.createElement('div');
    var c = card.style;
    c.maxWidth = '420px'; c.width = '100%'; c.textAlign = 'center';
    c.background = '#0f172a'; c.border = '1px solid #334155';
    c.borderRadius = '18px'; c.padding = '32px 26px';
    c.boxShadow = '0 20px 60px rgba(0,0,0,0.6)'; c.color = '#e2e8f0';

    var icono = document.createElement('div');
    icono.textContent = '\u23F0';
    icono.style.fontSize = '44px'; icono.style.marginBottom = '12px';

    var titulo = document.createElement('div');
    titulo.textContent = 'Periodo de prueba finalizado';
    titulo.style.fontSize = '20px'; titulo.style.fontWeight = '700';
    titulo.style.color = '#f8fafc'; titulo.style.marginBottom = '8px';

    var sub = document.createElement('div');
    sub.textContent = L.cliente || '';
    sub.style.fontSize = '12px'; sub.style.letterSpacing = '1px';
    sub.style.textTransform = 'uppercase'; sub.style.color = '#34d399';
    sub.style.fontWeight = '700'; sub.style.marginBottom = '16px';

    var txt = document.createElement('div');
    txt.textContent = L.contacto || 'Contactate con el proveedor para renovar el acceso.';
    txt.style.fontSize = '14px'; txt.style.lineHeight = '1.5'; txt.style.color = '#94a3b8';

    card.appendChild(icono); card.appendChild(titulo);
    card.appendChild(sub); card.appendChild(txt);
    ov.appendChild(card);
    (document.body || document.documentElement).appendChild(ov);

    document.documentElement.style.overflow = 'hidden';
    if (document.body) document.body.style.overflow = 'hidden';
  }

  // ---- Modo solo lectura: banner fijo + deshabilitar todos los botones ----
  function modoSoloLectura() {
    bannerFijo('\u26A0 Prueba vencida \u2014 modo solo lectura. ' + (L.contacto || ''),
               '#7f1d1d', '#fecaca');
    function desactivar() {
      var btns = document.querySelectorAll('button, input[type=submit], input[type=button]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.getAttribute('data-licencia-ok') === '1') continue;
        b.disabled = true;
        b.style.opacity = '0.5';
        b.style.cursor = 'not-allowed';
      }
    }
    desactivar();
    try {
      var obs = new MutationObserver(desactivar);
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  function aplicarVencimiento() {
    if (bloqueado) return;
    bloqueado = true;
    ocultarContador();
    if (L.modo === 'solo-lectura') modoSoloLectura();
    else modoBloqueo();
  }

  // Crea un banner fijo arriba de todo.
  function bannerFijo(mensaje, fondo, color) {
    if (document.getElementById('licenciaBanner')) return;
    var b = document.createElement('div');
    b.id = 'licenciaBanner';
    var s = b.style;
    s.position = 'fixed'; s.top = '0'; s.left = '0'; s.right = '0';
    s.zIndex = '2147483646';
    s.background = fondo; s.color = color;
    s.font = '600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    s.padding = '10px 16px'; s.textAlign = 'center';
    s.boxShadow = '0 2px 10px rgba(0,0,0,0.4)';
    b.textContent = mensaje;
    (document.body || document.documentElement).appendChild(b);
  }

  // ---- Arranque ----
  function iniciar() {
    // 1) Chequeo inmediato con la hora local.
    if (ahora() >= venceMs) { aplicarVencimiento(); return; }
    crearContador();
    tick = setInterval(actualizarContador, 1000);
    // 2) Confirmacion con la hora del servidor (atrapa relojes cambiados a mano).
    horaServidor().then(function (hs) {
      if (hs) {
        offsetServidorMs = hs - Date.now();
        actualizarContador();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
