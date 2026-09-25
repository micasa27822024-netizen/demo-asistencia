# Demo Asistencia — correcciones de seguridad aplicadas

Esta carpeta contiene una versión endurecida de los cuatro módulos actuales y la infraestructura necesaria para avanzar sobre el **Resumen Ejecutivo de la auditoría**.

## 1. P0 — Autenticación y permisos

- `admin.html`: acceso mediante Firebase Authentication + custom claim `role=admin`; se eliminó la contraseña fija del JavaScript y el acceso por `sessionStorage`.
- `panel.html`: acceso mediante Firebase Authentication + `role=supervisor`; se eliminó la contraseña fija y el acceso por `sessionStorage`.
- `index.html`: el vigilador entra mediante Firebase Authentication (`legajo@demo.asistencia` + clave temporal/PIN); la clave deja de viajar dentro de la fichada y ya no se guarda en `/personal`.
- `mis-horas.html`: usa Firebase Authentication y limita las consultas al legajo autenticado.
- `da-security.js`: añade el ID token de Firebase a las peticiones REST de Realtime Database.
- Alta y baja de vigiladores: `functions/index.js` crea y elimina cuentas Auth desde backend; al editar personal el legajo queda de solo lectura porque es la identidad de Auth.

## 2. P1 — Autoridad de la fichada

- La fichada se escribe primero en `/fichadasPendientes` y el backend decide si se acepta.
- El backend comprueba: vigilador activo, identidad/legajo, tipo de fichada, objetivo autorizado, existencia del objetivo, geocerca, duplicados y existencia de una ENTRADA activa para una SALIDA.
- `timestampServidor` es generado/validado por Firebase/Cloud Functions. La hora del dispositivo se conserva como evidencia del evento.
- El horario y las tolerancias se recalculan en backend; no se acepta como autoridad final el `estadoHorario`, `minutosTardanza`, `minutosAnticipacion` o `minutosExtra` enviados por el navegador.
- Se conserva la corrección de turnos nocturnos y la regla de que una salida anterior al inicio programado no se clasifica como salida anticipada.
- Para eventos offline se admite la hora del evento dentro de una ventana máxima de 48 h y se registra aparte la hora real de sincronización del servidor.

## 3. P1 — Offline / WebAuthn

- `index.html` puede funcionar en dos modos: `FOTO` o `WEBAUTHN`.
- `FOTO`: `face-api.js` se carga de forma diferida solo cuando la empresa usa este método.
- `WEBAUTHN`: se registra la credencial pública del dispositivo, se precargan challenges de un solo uso y la assertion queda en la cola offline.
- `functions/index.js` valida la assertion, challenge, origen/RP ID y contador criptográfico antes de aceptar una fichada WebAuthn.
- La huella/Face ID no se envía al servidor; se valida en el autenticador del dispositivo y se transmite la prueba criptográfica.
- La cola local sigue siendo manipulable por el usuario del dispositivo; la aceptación definitiva depende del backend.

## 4. P1 — XSS, datos y alertas

- Las alertas operativas ya no se escriben directamente en `/alertasFichadas` desde el cliente. Los intentos de ubicación bloqueados pasan a `/alertasFichadasPendientes` y el backend los promueve a la colección final.
- Las alertas de tardanza y salida anticipada se generan desde la fichada validada por el servidor.
- Las reglas restringen acceso por rol y evitan que un vigilador lea colecciones globales.
- Se añadieron índices básicos para las consultas por legajo y timestamp.
- El panel dejó de leer la raíz completa de Firebase y ahora consulta `/fichadas` con `limitToLast=2000`.
- El legajo es inmutable desde la edición de personal para evitar desalinear la identidad de Auth.

## 5. P1 — Auditoría

`functions/index.js` registra cambios en:

- `/personal`
- `/objetivos`
- `/asignacionesTurnos`
- `/configuracionAsistencia`
- `/configuracionEmpresa`
- `/alertasFichadasEliminadas`

Los registros se escriben en `/auditoria`; las reglas impiden la escritura directa del cliente.

## 6. P2 — Multiempresa

`da-config.js` + `companies.json` dejan una sola base de código con configuración por dominio. Cada empresa puede apuntar a su propio proyecto Firebase/Auth/Realtime Database.

La estructura queda preparada para la evolución hacia un **proyecto maestro** que asigne el tenant según `window.location.hostname`. El proyecto maestro real y sus credenciales/dominios todavía requieren configuración externa; no se inventaron esos datos en los archivos.

## 7. P2 — Producción

Se dejaron headers recomendados en `security-headers.example.conf` y se mantiene la separación de recursos de seguridad.

Todavía hay trabajo de producción que **no se debe activar a ciegas**: migrar scripts inline a archivos/nonce/hash, fijar SRI real para cada CDN, compilar Tailwind y ejecutar pruebas con Firebase Emulator Suite.

## Configuración obligatoria antes de usar esta versión

1. Completar la configuración Web de cada proyecto Firebase en `companies.json` (`apiKey`, `appId`, etc.).
2. Habilitar Firebase Authentication → proveedor **Correo electrónico/contraseña**.
3. Crear el primer usuario administrador con Admin SDK y asignar `{ role: "admin" }`.
4. Migrar los vigiladores actuales con `functions/migrate-pins.js` una sola vez y comprobar que el PIN/clave ya no exista en `/personal`.
5. Desplegar `database.rules.json` y `functions` antes de cerrar el acceso de producción.
6. Para WebAuthn, usar HTTPS y registrar primero la credencial desde el dispositivo de cada vigilador.

## Archivos principales

- `index.html`
- `admin.html`
- `panel.html`
- `mis-horas.html`
- `da-config.js`
- `da-security.js`
- `database.rules.json`
- `functions/index.js`
- `functions/migrate-pins.js`
- `functions/package.json`
- `firebase.json`
- `security-headers.example.conf`
- `companies.json`
