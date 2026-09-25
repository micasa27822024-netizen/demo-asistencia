# Primer acceso a Admin

La configuración de `companies.json` ya contiene el proyecto Firebase `fir-asistencia-fad12` y el administrador autorizado `micasa27822024@gmail.com`.

Importante: `admins` NO crea la cuenta de Firebase. Solo indica qué cuenta autenticada debe recibir el rol de administrador.

En Firebase Console → Authentication → Sign-in method, habilitá Email/Password. Luego en Authentication → Users → Add user, creá:

- correo: `micasa27822024@gmail.com`
- contraseña: una contraseña propia de Firebase Authentication

No es necesario que sea la contraseña de Gmail.

Después, al entrar a `admin.html`, el correo quedará sugerido automáticamente. La cuenta podrá entrar porque su correo está incluido en `companies.json` como administrador.
