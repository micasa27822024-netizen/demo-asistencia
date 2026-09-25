# Configuración de Firebase Authentication

La versión segura necesita la configuración pública de la aplicación Web de Firebase.

1. Firebase Console → Proyecto `fir-asistencia-fad12` → ⚙️ Configuración del proyecto.
2. En **Tus apps**, abrir la aplicación Web existente o registrar una nueva aplicación Web.
3. Copiar el objeto `firebaseConfig` completo.
4. Reemplazar en `companies.json` estos campos del bloque `firebase`: `apiKey`, `messagingSenderId` y `appId` (los demás ya están preparados para el proyecto actual).
5. Firebase Console → Authentication → Sign-in method → habilitar **Correo electrónico/contraseña**.
6. Crear al menos una cuenta para Admin y asignarle el custom claim `role: "admin"` desde el backend/Admin SDK. Para Supervisor, `role: "supervisor"`.

La `apiKey` de Firebase para aplicaciones web no es un secreto privado; la protección real está en Authentication y en las Security Rules. No colocar claves privadas de Admin SDK en estos HTML.
