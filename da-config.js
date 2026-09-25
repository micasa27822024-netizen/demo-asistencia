/*
 * Demo Asistencia - configuración de empresa/tenant
 * No contiene secretos. La API key de Firebase es un identificador de la app,
 * pero debe quedar acompañada por Security Rules estrictas.
 */
(function () {
  'use strict';

  const DEMO_FIREBASE = {
    apiKey: '',
    authDomain: 'fir-asistencia-fad12.firebaseapp.com',
    projectId: 'fir-asistencia-fad12',
    databaseURL: 'https://fir-asistencia-fad12-default-rtdb.firebaseio.com',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };

  const DEFAULT_COMPANY = {
    id: 'demo',
    nombre: 'Demo Asistencia',
    dominio: 'localhost',
    metodoIdentificacion: 'FOTO',
    firebase: DEMO_FIREBASE,
    seguridad: {
      authRequired: true,
      serverValidationRequired: true
    }
  };

  let current = null;
  let readyResolve;
  let readyReject;

  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function normalizarHost(host) {
    return String(host || '').trim().toLowerCase().replace(/\\.$/, '');
  }

  function hostMatches(entry, host) {
    const dominio = normalizarHost(entry.dominio || entry.host || '');
    if (!dominio) return false;
    if (dominio === host) return true;
    if (dominio.startsWith('*.')) {
      return host.endsWith(dominio.slice(1));
    }
    return false;
  }

  async function descubrirFirebaseConfig(base) {
    const baseCfg = { ...(base || {}) };
    if (baseCfg.apiKey) return baseCfg;

    const projectId = String(baseCfg.projectId || '').trim();
    const candidatos = [];
    if (projectId) {
      candidatos.push(`https://${projectId}.firebaseapp.com/__/firebase/init.json`);
      candidatos.push(`https://${projectId}.web.app/__/firebase/init.json`);
    }

    for (const url of candidatos) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const discovered = await res.json();
        if (discovered && discovered.apiKey) {
          return { ...baseCfg, ...discovered };
        }
      } catch (e) {
        // Se sigue con el siguiente método/fuente.
      }
    }

    return baseCfg;
  }

  async function cargar() {
    const host = normalizarHost(window.location.hostname);
    let company = null;

    try {
      const res = await fetch('./companies.json?ts=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const companies = Array.isArray(data) ? data : Object.values(data || {});
        company = companies.find(item => hostMatches(item, host)) || null;
      }
    } catch (e) {
      // El archivo es opcional para el entorno local; se usa el tenant demo.
    }

    if (!company && (host === 'localhost' || host === '127.0.0.1' || host === '')) {
      company = DEFAULT_COMPANY;
    }

    if (!company) {
      // Para facilitar la prueba del proyecto actual, el tenant demo también se usa
      // en GitHub Pages. En producción conviene registrar explícitamente cada host.
      const isGithub = host.endsWith('.github.io');
      if (isGithub) company = { ...DEFAULT_COMPANY, dominio: host };
    }

    if (!company) {
      current = {
        ...DEFAULT_COMPANY,
        estado: 'HOST_NO_REGISTRADO',
        error: `El dominio ${host || '(vacío)'} no está registrado en companies.json.`
      };
      readyResolve(current);
      return current;
    }

    const firebase = await descubrirFirebaseConfig(company.firebase || DEFAULT_COMPANY.firebase);
    current = {
      ...DEFAULT_COMPANY,
      ...company,
      firebase: { ...DEFAULT_COMPANY.firebase, ...firebase },
      estado: 'OK'
    };

    readyResolve(current);
    return current;
  }

  window.DAConfig = {
    ready,
    load: cargar,
    get current() { return current; },
    get defaultCompany() { return DEFAULT_COMPANY; }
  };

  cargar().catch(err => {
    current = { ...DEFAULT_COMPANY, estado: 'ERROR', error: err?.message || String(err) };
    readyReject(err);
  });
})();
