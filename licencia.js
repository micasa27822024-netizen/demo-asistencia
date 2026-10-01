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

  // Cuantos dias antes del vencimiento empieza a mostrar un cartelito de aviso.
  avisarDiasAntes: 3,

  // Texto de contacto que se muestra cuando vence (telefono, mail, lo que quieras).
  contacto: "Contactate con el proveedor para renovar el acceso."
};

/* ========================= LOGICA (no editar) ============================ */
(function () {
  var L = window.LICENCIA || {};
  var venceMs = Date.parse(L.vence);
  if (!venceMs || isNaN(venceMs)) return; // Sin fecha valida: no hace nada.

  var MS_DIA = 86400000;
  var bloqueado = false;
  var avisoHecho = false;

  function diasRestantes(ahora) {
    return Math.ceil((venceMs - ahora) / MS_DIA);
  }

  // Evalua con una hora dada: si ya paso el vencimiento, aplica el bloqueo;
  // si falta poco, muestra el aviso.
  function evaluar(ahora) {
    if (ahora >= venceMs) {
      aplicarVencimiento();
    } else {
      var d = diasRestantes(ahora);
      if (d <= (L.avisarDiasAntes || 0)) mostrarAviso(d);
    }
  }

  // Hora oficial tomada del SERVIDOR (header Date de la respuesta HTTP).
  // Es resistente a que cambien el reloj del telefono/compu. Si falla
  // (sin conexion), devuelve null y se usa la hora local como respaldo.
  function horaServidor() {
    return fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) {
        var d = r.headers.get('date');
        if (d) { var t = Date.parse(d); if (!isNaN(t)) return t; }
        return null;
      })
      .catch(function () { return null; });
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
    icono.textContent = '\u23F0'; // reloj
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
    bannerFijo('\u26A0 Prueba vencida \u2014 modo solo lectura. ' +
               (L.contacto || ''), '#7f1d1d', '#fecaca');
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
    if (L.modo === 'solo-lectura') modoSoloLectura();
    else modoBloqueo();
  }

  // ---- Cartelito de aviso previo (no bloquea, se puede cerrar) ----
  function mostrarAviso(dias) {
    if (avisoHecho) return;
    avisoHecho = true;
    var txt = (dias <= 0)
      ? 'La prueba vence hoy.'
      : ('La prueba vence en ' + dias + (dias === 1 ? ' dia.' : ' dias.'));
    bannerFijo('\u23F3 ' + txt + ' ' + (L.contacto || ''), '#78350f', '#fde68a', true);
  }

  // Crea un banner fijo arriba de todo. cerrable=true agrega una X.
  function bannerFijo(mensaje, fondo, color, cerrable) {
    if (document.getElementById('licenciaBanner')) return;
    var b = document.createElement('div');
    b.id = 'licenciaBanner';
    var s = b.style;
    s.position = 'fixed'; s.top = '0'; s.left = '0'; s.right = '0';
    s.zIndex = '2147483646';
    s.background = fondo; s.color = color;
    s.font = '600 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    s.padding = '10px 44px 10px 16px'; s.textAlign = 'center';
    s.boxShadow = '0 2px 10px rgba(0,0,0,0.4)';
    b.textContent = mensaje;
    if (cerrable) {
      var x = document.createElement('span');
      x.textContent = '\u2715';
      var xs = x.style;
      xs.position = 'absolute'; xs.right = '14px'; xs.top = '50%';
      xs.transform = 'translateY(-50%)'; xs.cursor = 'pointer';
      xs.fontWeight = '700'; xs.opacity = '0.8';
      x.addEventListener('click', function () { b.remove(); });
      b.appendChild(x);
    }
    (document.body || document.documentElement).appendChild(b);
  }

  // ---- Arranque ----
  function iniciar() {
    // 1) Chequeo inmediato con la hora local (bloqueo instantaneo si ya vencio).
    evaluar(Date.now());
    // 2) Confirmacion con la hora del servidor (atrapa relojes atrasados a mano).
    horaServidor().then(function (hs) {
      if (hs) evaluar(hs);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
