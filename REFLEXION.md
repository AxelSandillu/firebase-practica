# REFLEXIÓN - Práctica CI/CD con Firebase Hosting

## Mediciones de `check-headers.mjs`

### Antes (B1)

Medido en local (emulador de Hosting) con el `firebase.json` original de la práctica (commit `3320b8b`, sin headers), porque no se guardó la medición en producción antes de modificarlo.

```
$ node scripts/check-headers.mjs http://localhost:5000

▶ HTML: http://localhost:5000/
  status 200
  ✘ content-security-policy (falta)
  ✘ strict-transport-security (falta)
  ✘ x-content-type-options (falta)
  ✘ x-frame-options (falta)
  ✘ referrer-policy (falta)
  ✘ permissions-policy (falta)
  · cache-control: (no definido)

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✘ cache-control: (no definido)

❌ 7 control(es) pendiente(s).
```

### Después (B5)

Medido en producción tras mergear el PR de headers.

```
$ node scripts/check-headers.mjs https://fir-practica-72f70.web.app/

▶ HTML: https://fir-practica-72f70.web.app/
  status 200
  ✔ content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https:…
  ✔ strict-transport-security: max-age=31556926; includeSubDomains; preload
  ✔ x-content-type-options: nosniff
  ✔ x-frame-options: DENY
  ✔ referrer-policy: no-referrer
  ✔ permissions-policy: camera=(), microphone=(), geolocation=()
  · cache-control: no-cache

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✔ cache-control: public, max-age=31536000, immutable

✅ Todos los controles pasaron.
```

### Comparación

Se pasó de 7 controles pendientes (sin ningún header de seguridad ni `Cache-Control`) a todos los controles aprobados: CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` en el HTML, y caché inmutable de un año en `/_next/static/`, con el HTML en `no-cache`.

## 1. ¿Por qué el preview tiene vencimiento? ¿Qué riesgos tendría un preview que no vence nunca?

El preview tiene vencimiento (`expires: 3d`) porque los preview channels son entornos efímeros destinados a revisar un Pull Request específico antes de hacer merge. Si no vencieran:

- Se acumularían canales obsoletos consumiendo cuota de Firebase Hosting (el plan Spark tiene límites de almacenamiento y transferencia).
- Habría URLs públicas olvidadas que podrían exponer versiones parciales, inseguras o con datos de prueba de la aplicación.
- Se perdería la trazabilidad: no se sabría qué versión corresponde a qué PR si hay cientos de previews activos simultáneamente.
- Riesgo de seguridad: un preview con una rama antigua podría seguir siendo accesible y contener vulnerabilidades ya corregidas en `main`.

## 2. ¿Qué diferencia hay entre desplegar y liberar? ¿Dónde aparece cada concepto en este flujo?

- **Desplegar (deploy):** Copiar los archivos compilados al entorno de hosting. En este flujo ocurre en cada push a PR (preview channel) y en cada push a `main` (canal live). Es una operación técnica de subida de artefactos.
- **Liberar (release):** Hacer que una versión esté disponible para los usuarios finales. En este flujo, la liberación a producción ocurre cuando el workflow de `main` desplega al canal `live`, que es lo que el usuario final ve en `https://<PROJECT_ID>.web.app`.

Un preview se despliega pero no se "libera" al público general (solo se comparte la URL con el equipo de revisión). El rollback en Firebase Hosting revierte la liberación sin necesidad de re-desplegar el código.

## 3. ¿Por qué la clave de la service account va en un secreto y no en el repo? ¿Qué podría hacer alguien que la obtenga? ¿Cómo limitarías el daño?

Va en un secreto porque el repo es público (o al menos accesible por varios desarrolladores) y la clave JSON de la service account es una credencial con privilegios de despliegue. Si estuviera commitada, cualquiera con lectura al repo podría obtenerla.

Alguien que la obtenga podría:

- Desplegar versiones arbitrarias al proyecto Firebase (incluido producción).
- Borrar canales de preview, modificar la configuración de Hosting.
- Leer o modificar otros recursos del proyecto Firebase según los permisos de la service account.

Para limitar el daño:

- Usar una service account con el mínimo privilegio necesario (solo `firebasehosting.admin` o similar, no permisos de owner sobre todo el proyecto).
- Rotar la clave periódicamente.
- Monitorear los logs de Firebase Console para detectar deploys no autorizados.
- Usar GitHub Environments con aprobación manual para producción (A5), de modo que aunque se tenga la clave, un deploy a `live` requiera aprobación humana.

## 4. La CSP rompió la app: ¿por qué? ¿Qué opciones evaluaste y qué costo de seguridad tiene cada una?

La CSP rompió la app porque:

- La página de inicio carga una imagen externa desde `https://picsum.photos/...`. Al hacer el request, `picsum.photos` responde con un redirect `302` a `https://fastly.picsum.photos/id/...jpg`, por lo que el navegador necesita que `img-src` permita **ambos orígenes**: `https://picsum.photos` (la petición inicial) y `https://fastly.picsum.photos` (el destino del redirect donde se sirve la imagen real). Si `img-src` solo permite `'self'`, la imagen queda bloqueada.
- Next.js con export estático genera scripts y estilos en línea (inline) para la hidratación de React y componentes cliente (`FiltroCursos.tsx` es `"use client"`). Con `script-src 'self'` y `style-src 'self'` sin `'unsafe-inline'`, el navegador bloquea esos scripts y estilos, rompiendo la interactividad del filtro de cursos.

Opciones evaluadas:

1. **`script-src 'self' 'unsafe-inline'` y `style-src 'self' 'unsafe-inline'`**: La app funciona inmediatamente. Costo de seguridad: permite ejecución de cualquier script o estilo inyectado por un atacante (XSS), debilitando la protección principal de la CSP.

2. **CSP con hashes (`'sha256-...'`) para cada script/estilo en línea**: Más seguro porque solo se ejecutan scripts cuyos hashes coinciden exactamente. Costo: requiere recalcular los hashes en cada build y actualizar la CSP automáticamente en el pipeline; cualquier cambio en el código rompe la app hasta que se actualice el hash.

3. **Eliminar scripts/estilos en línea refactorizando el código**: Costo más alto de desarrollo pero seguridad máxima. No siempre es posible con Next.js export estático sin cambiar la arquitectura.

Decisión: Se usó `'unsafe-inline'` para que la app funcione, documentado como una limitación. El desafío extra sería migrar a hashes calculados en el pipeline.

## 5. Para cada header de B2, ¿qué ataque mitiga?

| Header                              | Ataque que mitiga                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strict-Transport-Security**       | Ataques de downgrade (forzar que el navegador use HTTP en lugar de HTTPS) y robo de cookies de sesión por conexiones no seguras.                                                |
| **X-Content-Type-Options: nosniff** | MIME sniffing: evita que el navegador interprete un archivo como un tipo distinto al declarado (por ejemplo, tratar un archivo subido por el usuario como HTML ejecutable).     |
| **X-Frame-Options: DENY**           | Clickjacking: impide que el sitio se incruste en un iframe de otro sitio malicioso que capture clics del usuario.                                                               |
| **Referrer-Policy: no-referrer**    | Filtración de información: evita que se envíe la URL completa (que podría contener tokens o datos sensibles en query strings) a sitios de terceros al seguir enlaces salientes. |
| **Permissions-Policy**              | Uso no autorizado de APIs del navegador (cámara, micrófono, geolocalización) por la página o por iframes embebidos.                                                             |

## 6. ¿Por qué los assets de `/_next/static/` pueden cachearse un año y el HTML no?

Los archivos bajo `/_next/static/` tienen nombres que incluyen un hash de contenido (por ejemplo, `_next/static/chunks/app-xyz.js`). Si el contenido cambia, cambia el nombre del archivo, por lo que el navegador nunca sirve una versión obsoleta de un asset ya cacheado. Pueden cachearse como inmutables (`max-age=31536000, immutable`) sin riesgo de servir contenido desactualizado.

El HTML no puede cachearse sin revalidar porque no tiene versionado en la URL: siempre se sirve en la misma ruta (por ejemplo, `/cursos`). Si se cacheara agresivamente, después de un deploy o un rollback los usuarios seguirían viendo la versión antigua en caché hasta que expirara, rompiendo la trazabilidad y haciendo que los rollbacks tardaran en hacerse efectivos. Por eso se usa `Cache-Control: no-cache` como regla general para `**`, y solo los assets versionados de `/_next/static/` se cachean como inmutables (`max-age=31536000, immutable`).

## 7. Si la app necesitara SSR, ¿qué cambiaría en la arquitectura, en la CSP y en el costo?

- **Arquitectura:** Firebase Hosting en plan Spark solo sirve archivos estáticos, por lo que no soportaría SSR, Server Actions ni Route Handlers dinámicos. Sería necesario migrar a **Firebase App Hosting** (que corre sobre Cloud Run) o a otra plataforma que soporte Node.js server-side.
- **CSP:** Con SSR hay más scripts generados dinámicamente y posibles inyecciones de datos del servidor al cliente (`__NEXT_DATA__` más grande, posible uso de `next/script` con estrategias dinámicas). Sería más difícil usar hashes estáticos; probablemente se requerirían nonces generados por request (posibles con un servidor, imposibles en export estático puro).
- **Costo:** App Hosting sobre Cloud Run requiere el plan **Blaze** de Firebase (con cuenta de facturación), por lo que el costo deja de ser cero. También habría costo de cómputo por las ejecuciones server-side, no solo de almacenamiento y transferencia de archivos estáticos.

# REFLEXIÓN — Clase 2 · SQL Connect: modelo relacional y autorización

## Auditoría de seguridad (`npm run atacar`)

### Antes de corregir (L4 sin resolver)

Corrida con el esquema y las operaciones L1/L2/L3/L5 ya escritas. La única vulnerabilidad que queda es la operación heredada `ListAlumnos`, que filtra datos personales sin login. (En la primera corrida, con los TODOs sin hacer, además aparecían `Inscribirme` y los controles de aislamiento como *pendientes* por no existir las operaciones.)

```
$ npm run atacar

Auditoría de SQL Connect · proyecto fir-practica-72f70 · emuladores locales

✔ ListCursos responde sin login (7 cursos) — público por diseño
✘ ListAlumnos devuelve datos personales SIN login
    Ejemplo filtrado: {"email":"ana@ejemplo.test","id":"seed-uid-ana","nombre":"Ana Ficticia"}
✔ Inscribirme rechazada sin login
    unauthenticated: this operation requires a signed-in user
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✔ B no puede dar de baja a A

❌ 1 vulnerabilidad(es) · 0 pendiente(s)
```

### Después de corregir

Con `ListAlumnos` en `NO_ACCESS`:

```
$ npm run atacar

Auditoría de SQL Connect · proyecto fir-practica-72f70 · emuladores locales

✔ ListCursos responde sin login (7 cursos) — público por diseño
✔ ListAlumnos rechazada para un cliente
    unauthorized: you are not authorized to perform this operation
✔ Inscribirme rechazada sin login
    unauthenticated: this operation requires a signed-in user
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✔ B no puede dar de baja a A

✅ Todos los controles pasaron
```

## 1. ¿Por qué ninguna operación recibe el id del alumno como variable? ¿Qué es IDOR y cómo lo evita `auth.uid`?

**IDOR** (Insecure Direct Object Reference, OWASP API Top 10 #1: Broken Object Level Authorization) es la vulnerabilidad en la que la API decide sobre qué objeto operar a partir de un identificador que manda el cliente, sin verificar que el objeto pertenezca a quien llama. Si `MisInscripciones` recibiera `$alumnoId` y filtrara por él, cualquier usuario autenticado cambiaría ese parámetro y leería las inscripciones (o se daría de baja) de otro.

Por eso ninguna operación del conector acepta un id de alumno: la identidad la aporta el **servidor**. `auth.uid` sale del ID token firmado por Firebase Auth, que el cliente no puede falsificar ni editar. `MisInscripciones` filtra con `alumno(key: { id_expr: "auth.uid" })`, y `Inscribirme`/`DarmeDeBaja` arman la clave con `alumnoId_expr: "auth.uid"`. El usuario siempre opera "en nombre de sí mismo": no existe el parámetro que habría que manipular, así que el IDOR queda cerrado por diseño y no por validación.

## 2. `ListCursos` es `PUBLIC` y `ListAlumnos` terminó en `NO_ACCESS`. ¿Qué criterio usaste? ¿Cómo haría el "panel de admin" para listar alumnos?

Criterio: **mínimo privilegio + naturaleza del dato**. `ListCursos` expone el catálogo, que es información pública por decisión del negocio (hay que poder ver los cursos antes de registrarse) y no contiene datos personales. `ListAlumnos` expone emails y UIDs de personas: es PII, y ninguna pantalla de la app la necesita. Además, el "requiere login" no la arregla: estar autenticado no significa estar autorizado a ver los datos de todos (cualquier alumno registrado podría leer los emails del resto).

El "panel de admin", que no forma parte de este cliente, debería:

- usar las **herramientas con privilegios de administrador** (consola de Firebase o `firebase dataconnect:execute`), que no pasan por `@auth` — por eso `NO_ACCESS` no le molesta;
- o, si fuera una app real: una operación dedicada que verifique **rol** (custom claims de Auth, p. ej. `admin: true`) y devuelva solo lo necesario (paginado, sin columnas que no se usen), protegida además con App Check. Autenticar ≠ autorizar: hace falta autorización por rol.

## 3. ¿Qué ventaja tiene una clave primaria compuesta en `Matricula` frente a validar duplicados en el código del cliente?

La clave compuesta `(alumnoId, cursoId)` es una **restricción de la base de datos**: PostgreSQL rechaza el duplicado sin importar quién escriba ni por dónde (la web, un script con la config pública, una operación futura, un bypass del cliente). La validación del cliente es cosmética: el código del cliente es público y modificable, y cualquiera llama a la API directamente saltándosela. La regla vive en un solo lugar que no se puede evitar.

Ventajas extra: el `matricula_upsert` sobre esa clave da la **idempotencia gratis** (inscribirse dos veces actualiza la misma fila en lugar de crear duplicados), y la integridad no depende de que cada desarrollador futuro recuerde re-validar. Preferí que la invariante viva en la base (garantía) y no en el código disperso (intención).

## 4. La configuración de Firebase (`apiKey`, etc.) es pública. ¿Por qué eso no compromete la base de datos? ¿Qué capa faltaría para frenar a alguien que usa esa config desde un script?

La `apiKey` **no es un secreto ni una credencial de acceso**: es un identificador de proyecto. Sirve para decir *a qué* proyecto hablar, no para *autorizar* nada. Quien la tenga puede llamar a las operaciones del conector, pero cada llamada pasa igual por `@auth`: podrá leer el catálogo (`PUBLIC`) y, si además crea una cuenta, inscribirse **a sí mismo** — nunca leer datos de otros ni escribir en su nombre. La seguridad está en Auth + los niveles de las operaciones, no en esconder la config (esa es la misma razón por la que viaja en el bundle sin ofuscar).

La capa que falta es **App Check**: ata la app a un proveedor de atestación (reCAPTCHA Enterprise, DeviceCheck, Play Integrity) y el backend rechaza el tráfico que no venga del sitio/binario legítimo. Un script que usa la config pública — exactamente lo que hace `scripts/atacar.mjs` — queda bloqueado aunque conozca la apiKey, porque no puede presentar el token de atestación válido. Complementan el defense in depth: App Check como veredicto de acceso, las reglas `@auth` como autorización por operación y los límites de cuota/monitoreo de la consola.

## 5. Comparado con una API REST propia (Express + `pg`), ¿qué te da SQL Connect y qué perdés?

**Da:** una API declarativa y tipada generada del esquema (el cliente manda nombre de operación + variables, jamás SQL, así que la inyección queda cerrada por diseño); autorización **junto a cada operación** (`@auth`) en lugar de middlewares dispersos en cada endpoint donde es fácil olvidar un chequeo (= IDOR); valores del servidor imposibles de falsificar (`auth.uid`, `auth.token.email`, `request.time`); cero servidores propios que mantener (encaja con el export estático y el plan Spark); emulador local con PostgreSQL embebido; y el SQL, el SDK cliente y las migraciones se generan solos.

**Perdés:** control del backend. Solo se puede exponer lo que una operación `.gql` expresa: no hay lógica arbitraria intermedia (transformaciones complejas, transacciones de varios pasos con reglas de negocio, agregaciones custom); el stack queda acoplado a PostgreSQL + GraphQL y al proveedor (vendor lock-in, cuota de ~8.000 operaciones diarias de la prueba, región fija); el debugging es más opaco que el propio servidor con sus logs; y las capacidades llegan cuando el servicio las agrega, no cuando vos las programás. Con Express + `pg` tenés todo el control — y también toda la responsabilidad: tokens, SQL/ORM, autorización correcta en cada endpoint, hosting y escalado.

## 6. ¿Por qué no alcanzó con la CSP de la clase 1 y por qué conviene listar dominios exactos en `connect-src`?

La CSP de la clase 1 no tenía `connect-src`, así que heredaba `default-src 'self'`: alcanzaba para una app puramente estática que solo carga sus propios archivos e imágenes de picsum. La clase 2 le agrega backend: el navegador ahora necesita conectarse a `identitytoolkit.googleapis.com` (crear cuenta / login), `securetoken.googleapis.com` (renovación del ID token) y `firebasedataconnect.googleapis.com` (todas las operaciones SQL Connect). Sin allowlist, el navegador las bloquea: *Refused to connect* y el catálogo no carga. Por eso se agregó `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasedataconnect.googleapis.com`.

No usamos `https://*.googleapis.com` porque ese comodín habilita **cientos** de hosts de Google (Drive, Storage, BigQuery, Functions de cualquier proyecto…) que la app jamás usa. La CSP es, sobre todo, el plan de contención de un XSS: define a dónde puede exfiltrar datos o con qué APIs comunicarse un script inyectado. Con orígenes exactos el atacante solo tiene lo mínimo que la app necesita; con el comodín, toda la superficie de Google. Además, si una versión futura del SDK empieza a llamar a un dominio nuevo, la consola lo muestra (*Refused to connect*) y se revisa conscientemente, en lugar de pasar desapercibido bajo el comodín.
