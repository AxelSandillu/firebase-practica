/**
 * Configuración web de tu proyecto Firebase.
 * Consola de Firebase → ⚙ Configuración del proyecto → General → Tus apps → App web → SDK setup and configuration
 *
 * Estos valores NO son secretos: viajan en el bundle de JavaScript y cualquiera puede verlos.
 * La seguridad no depende de esconderlos, sino de Auth + las reglas @auth de SQL Connect
 * (y, más adelante, App Check).
 *
 * Mientras desarrollás con `npm run dev`, la app usa los emuladores locales y no importa
 * si estos valores son reales. Para producción tenés que completarlos.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyAwS4LQtrc-_7jUFBYRsPYoH7G-IBfaiLg', // completar desde la consola antes del deploy (Parte D)
  authDomain: 'fir-practica-72f70.firebaseapp.com',
  projectId: 'fir-practica-72f70',
  appId: '1:960640921715:web:1cb1350e3d49c5b6ea7a06', // completar desde la consola antes del deploy (Parte D)
};

/** Debe coincidir con dataconnect/dataconnect.yaml y dataconnect/cursos/connector.yaml */
export const sqlConnectConfig = {
  location: 'us-east4',
  service: 'catalogo',
  connector: 'cursos',
};
