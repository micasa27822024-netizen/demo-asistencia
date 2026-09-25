/**
 * Demo Asistencia — Gestor Multi-Tenant y Verificación de Licencias
 */
window.DAConfig = (function () {
  let empresaActual = null;
  let empresasCache = null;

  // Credenciales reales integradas de tu proyecto fir-asistencia-fad12
  const CONFIG_DEFAULT = {
    id: "demo",
    nombre: "Demo Asistencia S.A.",
    dominio: "github.io",
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
      return [CONFIG_DEFAULT];
    } catch (e) {
      empresasCache = [CONFIG_DEFAULT];
      return empresasCache;
    }
  }

  async function resolverEmpresa() {
    if (empresaActual && empresaActual.firebase) return empresaActual;
    const lista = await cargarEmpresas();
    const host = window.location.hostname.toLowerCase();

    // 1. Buscar coincidencia de dominio
    let encontrada = lista.find(e => e && e.dominio && (host.includes(e.dominio.toLowerCase()) || e.dominio.toLowerCase().includes(host) || e.dominio === 'github.io'));
    
    // 2. Si no coincide exactamente, usar la primera que tenga firebase válido
    if (!encontrada || !encontrada.firebase) {
      encontrada = lista.find(e => e && e.firebase && e.firebase.apiKey) || CONFIG_DEFAULT;
    }

    // 3. Garantía absoluta: jamás devolver undefined
    if (!encontrada || !encontrada.firebase) {
      encontrada = CONFIG_DEFAULT;
    }

    empresaActual = encontrada;
    window.DAConfig.current = encontrada;
    return encontrada;
  }

  async function init() {
    return await resolverEmpresa();
  }

  async function getDatabaseUrl() {
    const emp = await resolverEmpresa();
    return emp.firebase.databaseURL;
  }

  async function getStorageBucket() {
    const emp = await resolverEmpresa();
    return emp.firebase.storageBucket || "fir-asistencia-fad12.firebasestorage.app";
  }

  async function verificarLicencia() {
    try {
      const emp = await resolverEmpresa();
      const res = await fetch(`${emp.firebase.databaseURL}/licencias/demo.json?ts=` + Date.now());
      if (!res.ok) return { activa: true };
      const lic = await res.json();
      if (!lic) return { activa: true };
      if (lic.activa === false) return { activa: false, motivo: lic.motivo || 'Licencia deshabilitada.' };
      return { activa: true, vencimiento: lic.vencimiento };
    } catch (e) {
      return { activa: true };
    }
  }

  return {
    init: init,
    resolverEmpresa: resolverEmpresa,
    current: CONFIG_DEFAULT,
    getDatabaseUrl: getDatabaseUrl,
    getStorageBucket: getStorageBucket,
    verificarLicencia: verificarLicencia
  };
})();
