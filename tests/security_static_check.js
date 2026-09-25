'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = ['index.html','admin.html','panel.html','mis-horas.html'];
const forbidden = [/PASSWORD_ADMIN/i, /PASSWORD_SUPERVISOR/i, /admin123/i, /sessionStorage/i];
let failed = false;
for (const file of html) {
  const s = fs.readFileSync(path.join(root, file), 'utf8');
  for (const re of forbidden) {
    if (re.test(s)) {
      console.error(`${file}: patrón inseguro encontrado: ${re}`);
      failed = true;
    }
  }
}
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
if (rules.rules['fichadas']?.['$id']?.['.write'] !== false) {
  console.error('Las fichadas finales deben ser solo de escritura backend.');
  failed = true;
}
if (rules.rules['auditoria']?.['.write'] !== false) {
  console.error('La auditoría no debe ser escribible por el cliente.');
  failed = true;
}
if (!failed) console.log('OK: chequeos estáticos de seguridad superados.');
process.exitCode = failed ? 1 : 0;
