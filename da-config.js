/**
 * Demo Asistencia — Gestor Multi-Tenant y Verificación de Licencias
 */
window.DAConfig = (function () {
  let empresaActual = null;
  let empresasCache = null;

  // Credenciales reales por defecto (evita errores si companies.json tarda en cargar)
  const CONFIG_REAL = {
    id: 'demo',
    nombre: 'Demo Asistencia S.A.',
    dominio: 'github.io',
    metodoIdentificacion: 'FOTO',
    firebase: {
      apiKey: "AIzaSyBYsTCQWwnqEaBzsC5P-9cTM6uBKCnKAmo",
      authDomain: "fir-asistencia-fad12.firebaseapp.com",
      projectId: "fir-asistencia-fad12",
      databaseURL: "https://fir-asistencia-fad12-default-rtdb.firebaseio.com",
      storageBucket: "fir-asistencia-fad12.firebasestorage.app",
      messagingSenderId: "441100861030",
      appId: "1:441100861030:web:b4287e1c3a377cf892b7a7"
    }
  };

  async function cargarEmpresas() {
    if (empresasCache) return empresasCache;
    try {
      const res = await fetch('./companies.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      empresasCache = await res.json();
      return empresasCache;
    } catch (e) {
      console.warn('Cargando configuración integrada de Firebase...');
      return [CONFIG_REAL];
    }
  }

  async function resolverEmpresa() {
    if (empresaActual) return empresaActual;
    const lista = await cargarEmpresas();
    const host = window.location.hostname.toLowerCase();
    
    // Buscar por dominio o usar la configuración activa
    let encontrada = lista.find(e => e.dominio && (host.includes(e.dominio.toLowerCase()) || e.dominio === 'github.io'));
    if (!encontrada) {
      encontrada = lista[0] || CONFIG_REAL;
    }
    empresaActual = encontrada;
    window.DAConfig.current = encontrada;
    return encontrada;
  }

  async function verificarLicencia(databaseURL) {
    try {
      const dbUrl = databaseURL || CONFIG_REAL.firebase.databaseURL;
      const res = await fetch(`${dbUrl}/licencias/demo.json?ts=` + Date.now());
      if (!res.ok) return { activa: true };
      const lic = await res.json();
      if (!lic) return { activa: true };
      
      if (lic.activa === false) {
        return { activa: false, motivo: lic.motivo || 'Licencia deshabilitada por administración.' };
      }
      return { activa: true, vencimiento: lic.vencimiento };
    } catch (e) {
      return { activa: true };
    }
  }

  return {
    init: resolverEmpresa,
    current: null,
    getDatabaseUrl: async () => {
      const emp = await resolverEmpresa();
      return emp.firebase.databaseURL;
    },
    getStorageBucket: async () => {
      const emp = await resolverEmpresa();
      return emp.firebase.storageBucket;
    },
    verificarLicencia: async () => {
      const emp = await resolverEmpresa();
      return await verificarLicencia(emp.firebase.databaseURL);
    }
  };
})();
