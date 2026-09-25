/**
 * Demo Asistencia — Gestor Multi-Tenant y Verificación de Licencias
 */
window.DAConfig = (function () {
  let empresaActual = null;
  let empresasCache = null;

  // Credenciales reales integradas de tu proyecto fir-asistencia-fad12
  const CONFIG_REAL = {
    id: "demo",
    nombre: "Demo Asistencia S.A.",
    dominio: "micasa27822024-netizen.github.io",
    metodoIdentificacion: "FOTO",
    firebase: {
      apiKey: "AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo",
      authDomain: "fir-asistencia-fad12.firebaseapp.com",
      projectId: "fir-asistencia-fad12",
      databaseURL: "https://fir-asistencia-fad12-default-rtdb.firebaseio.com",
      storageBucket: "fir-asistencia-fad12.firebasestorage.app",
      messagingSenderId: "441100861030",
      appId: "1:441100861030:web:b4287e1c3a377cf892b7a7"
    },
    seguridad: {
      authRequired: true,
      serverValidationRequired: true
    }
  };

  async function cargarEmpresas() {
    if (empresasCache && Array.isArray(empresasCache) && empresasCache.length > 0) {
      return empresasCache;
    }
    try {
      const url = new URL('companies.json?ts=' + Date.now(), window.location.href);
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        empresasCache = data;
        return empresasCache;
      }
      return [CONFIG_REAL];
    } catch (e) {
      empresasCache = [CONFIG_REAL];
      return empresasCache;
    }
  }

  async function resolverEmpresa() {
    if (empresaActual && empresaActual.firebase) return empresaActual;
    const lista = await cargarEmpresas();
    const host = window.location.hostname.toLowerCase();

    let encontrada = lista.find(e => e && e.dominio && (host.includes(e.dominio.toLowerCase()) || e.dominio.toLowerCase().includes(host)));
    if (!encontrada || !encontrada.firebase) {
      encontrada = lista.find(e => e && e.firebase && e.firebase.apiKey) || CONFIG_REAL;
    }
    if (!encontrada || !encontrada.firebase) {
      encontrada = CONFIG_REAL;
    }

    empresaActual = encontrada;
    window.DAConfig.current = encontrada;
    return encontrada;
  }

  return {
    init: resolverEmpresa,
    resolverEmpresa: resolverEmpresa,
    current: CONFIG_REAL,
    getDatabaseUrl: async () => {
      const emp = await resolverEmpresa();
      return emp.firebase.databaseURL;
    },
    getStorageBucket: async () => {
      const emp = await resolverEmpresa();
      return emp.firebase.storageBucket || "fir-asistencia-fad12.firebasestorage.app";
    },
    verificarLicencia: async () => {
      return { activa: true };
    }
  };
})();
