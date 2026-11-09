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

Corrida con el esquema y las operaciones L1/L2/L3/L5 ya escritas. La única vulnerabilidad que queda es la operación heredada `ListAlumnos`, que filtra datos personales sin login. (En la primera corrida, con los TODOs sin hacer, además aparecían `Inscribirme` y los controles de aislamiento como _pendientes_ por no existir las operaciones.)

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

## Verificación de producción (L7)

Con el deploy de SQL Connect y del frontend ya hechos sobre el proyecto `fir-practica-72f70`:

```
$ npx firebase dataconnect:services:list
Service ID: catalogo · Location: us-east4 · Data Source: CloudSQL Instance: catalogo-fdc
Database: fdcdb · Connector ID: cursos

$ npx firebase dataconnect:sql:diff
✔ Database schema of catalogo-fdc:fdcdb matches SQL Connect Schema exactly.

$ npx firebase dataconnect:execute dataconnect/cursos/queries.gql ListCursos
# 7 cursos leídos desde PostgreSQL en producción

$ node scripts/check-headers.mjs https://fir-practica-72f70.web.app/
✅ Todos los controles pasaron (CSP, HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy y caché)
```

También se habilitó **Correo electrónico/contraseña** en Authentication (sin eso, `createUserWithEmailAndPassword` devolvía `auth/operation-not-allowed`). La prueba end-to-end en producción —crear cuenta, `UpsertAlumno`, `Inscribirme`, `MisInscripciones` y `DarmeDeBaja`— confirmó que la inscripción no se duplica y que la baja borra solo la fila del usuario que llama.

Durante esa prueba apareció un detalle de la caché del SDK: `executeQuery` usa `PREFER_CACHE` por defecto y, como `lib/sqlconnect.ts` invoca operaciones por nombre (sin el SDK generado que invalida la caché), después de `DarmeDeBaja` la consulta seguía mostrando la inscripción. Se corrigió usando `fetchPolicy: QueryFetchPolicy.SERVER_ONLY` en `listarCursos` y `misInscripciones`, para que la UI refleje siempre el estado real del servidor.

---

## Práctica 3 · Firestore

### Enlaces de la entrega

- Pull Request mergeado (reglas, índice y CSP): (pegar URL del PR)
- Capturas y video de las pruebas (Drive): (pegar enlace a la carpeta)

### Evidencia de los tests de reglas

Los tests se ejecutan con `npm run test:reglas`, que levanta un emulador efímero de Firestore, corre `node --test` y lo apaga. Hay 15 tests: los 8 de la consigna y 7 propios. En las salidas se omitieron los avisos `PERMISSION_DENIED` que el SDK imprime cada vez que un test comprueba que una escritura **debe** ser rechazada (son esperados).

**1) Todo en verde** — salida de `npm run test:reglas`:

```
> firebase emulators:exec --only firestore --project demo-resenas "node --test tests/*.test.mjs"

i  Running script: node --test tests/*.test.mjs
✔ cualquiera puede leer reseñas, incluso sin login (2134.8314ms)
✔ Ana puede crear SU reseña (452.8063ms)
✔ Ana NO puede crear una reseña a nombre de Bruno (96.3387ms)
✔ sin login no se puede escribir (59.5904ms)
✔ puntaje fuera de rango o con decimales se rechaza (99.0597ms)
✔ no se pueden agregar campos extra (p. ej. destacada: true) (49.8817ms)
✔ la fecha de creación la pone el servidor y no se puede cambiar (198.019ms)
✔ el cliente no puede escribir el documento del curso (50.7969ms)
✔ Bruno NO puede editar ni borrar la reseña de Ana (83.5635ms)
✔ Ana puede editar (conservando la fecha) y borrar SU reseña (80.5994ms)
✔ sin login no se puede borrar una reseña (53.132ms)
✔ texto vacío o de más de 500 caracteres se rechaza (92.9265ms)
✔ autor vacío o de más de 80 caracteres se rechaza (80.1537ms)
✔ los tipos incorrectos se rechazan (puntaje como texto, texto como número) (75.8748ms)
✔ lo que no está habilitado queda cerrado (otras colecciones) (113.3131ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4624.5463
+  Script exited successfully (code 0)
```

**2) Haciéndolo fallar a propósito** — en `firestore.rules` cambié `d.puntaje <= 5` por `d.puntaje <= 6` y volví a correr los tests. Resultado: se puso en rojo **un solo test**, «puntaje fuera de rango o con decimales se rechaza» (14 pasaron y 1 falló). Falló en la línea 54 de `tests/reglas.test.mjs`, el intento de escribir `puntaje: 6`, con el error `Expected request to fail, but it succeeded`: con el límite en 6, la regla dejó pasar un puntaje inválido. Esto confirma que ese test sí depende de la regla del rango y no pasa «por casualidad». (Rutas abreviadas con `...`.)

```
✔ cualquiera puede leer reseñas, incluso sin login (2617.7447ms)
✔ Ana puede crear SU reseña (568.5233ms)
✔ Ana NO puede crear una reseña a nombre de Bruno (120.3662ms)
✔ sin login no se puede escribir (244.3448ms)
✖ puntaje fuera de rango o con decimales se rechaza (81.0922ms)
✔ no se pueden agregar campos extra (p. ej. destacada: true) (132.4994ms)
✔ la fecha de creación la pone el servidor y no se puede cambiar (274.7919ms)
✔ el cliente no puede escribir el documento del curso (46.8732ms)
✔ Bruno NO puede editar ni borrar la reseña de Ana (126.3379ms)
✔ Ana puede editar (conservando la fecha) y borrar SU reseña (79.3275ms)
✔ sin login no se puede borrar una reseña (91.5691ms)
✔ texto vacío o de más de 500 caracteres se rechaza (99.2109ms)
✔ autor vacío o de más de 80 caracteres se rechaza (55.4094ms)
✔ los tipos incorrectos se rechazan (puntaje como texto, texto como número) (67.9939ms)
✔ lo que no está habilitado queda cerrado (otras colecciones) (97.6343ms)
ℹ tests 15
ℹ suites 0
ℹ pass 14
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5701.2452

✖ failing tests:

test at tests\reglas.test.mjs:51:1
✖ puntaje fuera de rango o con decimales se rechaza (81.0922ms)
  Error: Expected request to fail, but it succeeded.
      at .../node_modules/@firebase/rules-unit-testing/dist/esm/index.esm.js:572:31
      at async TestContext.<anonymous> (.../tests/reglas.test.mjs:54:3)
!  Script exited unsuccessfully (code 1)

Error: Script "node --test tests/*.test.mjs" exited with code 1
```

Después revertí el cambio con `git checkout firestore.rules`, dejando de nuevo `d.puntaje <= 5`.

**Tests adicionales propios** (además de los 8 de la consigna): edición y borrado de la reseña ajena, borrado sin login, borrado y edición de la propia, texto vacío / de más de 500 caracteres, autor vacío / de más de 80, tipos incorrectos y colecciones no habilitadas.

### Evidencia de tiempo real

Capturas / video de la actualización en vivo entre dos navegadores (uno en modo incógnito, con otra cuenta): (pegar enlace de Drive o imágenes)

### Índices: emulador vs. producción

El emulador de Firestore **no exige índices**: la consulta «solo 5 estrellas» (`where puntaje == 5` + `orderBy creadaEn desc`) funciona en local aunque falte `firestore.indexes.json`. En producción, en cambio, esa misma consulta falla con `FAILED_PRECONDITION` («The query requires an index») hasta que el índice compuesto está construido, y la construcción tarda unos minutos después del deploy. Por eso el índice se declara en el repo (revisable en el PR y reproducible) y no se prueba solo en local: un «anda en mi máquina» acá no garantiza nada.

### 1. ¿Por qué el id del documento es el UID? ¿Qué tendrías que agregar si usaras ids aleatorios con `addDoc`?

Porque así «una reseña por persona y curso» queda garantizado por la **estructura**: escribir de nuevo en `cursos/{id}/resenas/{uid}` actualiza el mismo documento, no puede haber dos. Además las reglas pueden comparar directamente el id del documento con `request.auth.uid` (`esDuenio(uid)`), sin leer nada más.

Con ids aleatorios (`addDoc`) tendría que agregar:

- **En el documento:** un campo `uid` con el autor y agregarlo a la lista blanca (`hasOnly`/`hasAll`).
- **En las reglas:** en `create`, `request.resource.data.uid == request.auth.uid`; en `update`/`delete`, `resource.data.uid == request.auth.uid` (y que `uid` no cambie).
- **En código o reglas, para la unicidad:** algo que impida una segunda reseña de la misma persona. Las reglas no pueden hacer una consulta «¿ya existe alguna reseña mía?» (solo `get`/`exists` sobre una ruta exacta), así que habría que consultar antes desde el cliente (que se puede saltear) o resolverlo con otra estructura. El id = UID lo resuelve gratis y sin lecturas extra.

### 2. La reseña guarda una copia del nombre del autor. ¿Qué ganás y qué perdés? ¿Cómo resolverías el cambio de nombre?

- **Gano:** para mostrar la lista alcanza con **una lectura por reseña**; no hace falta una segunda lectura (un «join», que en Firestore no existe) para buscar el nombre de cada autor. Es más rápido y más barato.
- **Pierdo:** consistencia. Si alguien cambia su nombre, sus reseñas viejas conservan el anterior (dato desactualizado). Además, el nombre lo manda el cliente y las reglas solo validan su largo, así que alguien podría escribir cualquier `autor` (incluso el nombre de otra persona). Se podría endurecer exigiendo `autor == request.auth.token.name`.
- **Cambio de nombre:** tres caminos. (a) Aceptarlo como «el nombre al momento de escribir» (es lo que hace esta práctica, y es razonable para reseñas). (b) Al cambiar el nombre, actualizar las reseñas del usuario con una Cloud Function (Práctica 5) que haga una consulta de _collection group_ sobre `resenas` filtrando por autor y las reescriba por lotes. (c) No copiar el nombre y guardar solo el `uid`, con un documento público `perfiles/{uid}` del que se lee el nombre: nombres siempre actuales, pero a cambio de lecturas extra.

### 3. ¿Qué diferencia hay entre `resource.data` y `request.resource.data`? Ejemplo con ambos.

- `resource.data` es el documento **tal como está guardado ahora** en la base (no existe en un `create`).
- `request.resource.data` es el documento **como quedaría si se acepta la escritura** (en un `update` con `merge`, es el resultado ya mezclado).

Ejemplo, la regla de edición de este proyecto:

```
allow update: if esDuenio(uid)
  && resenaValida()                                                // valida request.resource.data (cómo quedaría)
  && request.resource.data.creadaEn == resource.data.creadaEn;     // lo nuevo == lo que ya había
```

Compara cómo quedaría (`request.resource.data.creadaEn`) con lo que hay hoy (`resource.data.creadaEn`) para que la fecha no cambie.

### 4. ¿Por qué la regla de creación exige `creadaEn == request.time` y no confía en la fecha del cliente?

Porque el reloj del cliente no es confiable: puede estar mal configurado o ser manipulado a propósito (alguien podría ponerse una reseña con fecha de 2020 o del futuro y alterar el orden de la lista). `request.time` es la hora del **servidor** al evaluar la solicitud, y `serverTimestamp()` es un marcador que el servidor reemplaza justamente por esa hora. Si el cliente manda otra cosa, `creadaEn == request.time` es falso y la escritura se rechaza (el test «la fecha de creación la pone el servidor» lo verifica).

### 5. ¿Qué limitación tiene `getAggregateFromServer` y cómo afecta la experiencia? ¿Qué alternativas hay?

Limitaciones: **no admite listeners** (no es en tiempo real: hay que volver a pedirlo), **no funciona offline** (siempre va al servidor) y cuesta una lectura por cada lote de hasta 1.000 entradas de índice leídas. Para el usuario: la lista se actualiza sola, pero el promedio y la cantidad quedan desactualizados hasta que el componente los vuelve a pedir; por eso el componente los recalcula cuando cambia la cantidad de reseñas y después de publicar o borrar. Las ediciones de _otras_ personas no actualizan el promedio de quien está mirando.

Alternativas: (a) guardar el resumen (`cantidad`, `suma`) en el documento del curso y mantenerlo con una Cloud Function que se dispare al crear/editar/borrar reseñas (es la Práctica 5); así sí se puede escuchar con `onSnapshot`; (b) mantener un contador con `increment()` desde el cliente, lo que obligaría a abrir la escritura sobre el curso y a validar con `getAfter()` en las reglas, mucho más frágil; (c) calcular el promedio en el cliente con las 20 reseñas que ya tiene, pero eso es un promedio **parcial**, no el real.

### 6. Para inscripciones con cupo máximo, ¿Firestore o SQL Connect? Justificá con lo que viste en las dos prácticas.

**SQL Connect (PostgreSQL).** Una inscripción con cupo es un problema de **integridad y concurrencia**, justo lo que encaja con el modelo relacional:

- En la Práctica 2, `Matricula` tiene clave primaria compuesta `(alumnoId, cursoId)` y `Curso` tiene la columna `cupo`: las reglas de integridad viven en la base y no se pueden saltear. Con el cupo, PostgreSQL permite verificar «cuántos hay inscriptos» y escribir la inscripción de forma **atómica** (misma transacción), de modo que dos personas no se queden con el último lugar a la vez.
- En Firestore, las reglas **no pueden contar** los documentos de una colección. Habría que mantener un contador en el documento del curso, actualizarlo en la misma transacción/lote que la inscripción y validarlo con `getAfter()`. Es posible pero frágil, y ese documento sería un punto caliente (Firestore recomienda no superar ~1 escritura por segundo sostenida sobre un mismo documento), justo cuando se abre la inscripción y todos escriben a la vez.

Firestore brilla en lo que vimos hoy: datos que cambian y se ven **en vivo** en muchos clientes, con esquema flexible (reseñas, chats, tableros). Para inscripciones, lo más importante es que **sea correcto**, no que sea instantáneo en tiempo real.

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

La `apiKey` **no es un secreto ni una credencial de acceso**: es un identificador de proyecto. Sirve para decir _a qué_ proyecto hablar, no para _autorizar_ nada. Quien la tenga puede llamar a las operaciones del conector, pero cada llamada pasa igual por `@auth`: podrá leer el catálogo (`PUBLIC`) y, si además crea una cuenta, inscribirse **a sí mismo** — nunca leer datos de otros ni escribir en su nombre. La seguridad está en Auth + los niveles de las operaciones, no en esconder la config (esa es la misma razón por la que viaja en el bundle sin ofuscar).

La capa que falta es **App Check**: ata la app a un proveedor de atestación (reCAPTCHA Enterprise, DeviceCheck, Play Integrity) y el backend rechaza el tráfico que no venga del sitio/binario legítimo. Un script que usa la config pública — exactamente lo que hace `scripts/atacar.mjs` — queda bloqueado aunque conozca la apiKey, porque no puede presentar el token de atestación válido. Complementan el defense in depth: App Check como veredicto de acceso, las reglas `@auth` como autorización por operación y los límites de cuota/monitoreo de la consola.

## 5. Comparado con una API REST propia (Express + `pg`), ¿qué te da SQL Connect y qué perdés?

**Da:** una API declarativa y tipada generada del esquema (el cliente manda nombre de operación + variables, jamás SQL, así que la inyección queda cerrada por diseño); autorización **junto a cada operación** (`@auth`) en lugar de middlewares dispersos en cada endpoint donde es fácil olvidar un chequeo (= IDOR); valores del servidor imposibles de falsificar (`auth.uid`, `auth.token.email`, `request.time`); cero servidores propios que mantener (encaja con el export estático y el plan Spark); emulador local con PostgreSQL embebido; y el SQL, el SDK cliente y las migraciones se generan solos.

**Perdés:** control del backend. Solo se puede exponer lo que una operación `.gql` expresa: no hay lógica arbitraria intermedia (transformaciones complejas, transacciones de varios pasos con reglas de negocio, agregaciones custom); el stack queda acoplado a PostgreSQL + GraphQL y al proveedor (vendor lock-in, cuota de ~8.000 operaciones diarias de la prueba, región fija); el debugging es más opaco que el propio servidor con sus logs; y las capacidades llegan cuando el servicio las agrega, no cuando vos las programás. Con Express + `pg` tenés todo el control — y también toda la responsabilidad: tokens, SQL/ORM, autorización correcta en cada endpoint, hosting y escalado.

## 6. ¿Por qué no alcanzó con la CSP de la clase 1 y por qué conviene listar dominios exactos en `connect-src`?

La CSP de la clase 1 no tenía `connect-src`, así que heredaba `default-src 'self'`: alcanzaba para una app puramente estática que solo carga sus propios archivos e imágenes de picsum. La clase 2 le agrega backend: el navegador ahora necesita conectarse a `identitytoolkit.googleapis.com` (crear cuenta / login), `securetoken.googleapis.com` (renovación del ID token) y `firebasedataconnect.googleapis.com` (todas las operaciones SQL Connect). Sin allowlist, el navegador las bloquea: _Refused to connect_ y el catálogo no carga. Por eso se agregó `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasedataconnect.googleapis.com`.

No usamos `https://*.googleapis.com` porque ese comodín habilita **cientos** de hosts de Google (Drive, Storage, BigQuery, Functions de cualquier proyecto…) que la app jamás usa. La CSP es, sobre todo, el plan de contención de un XSS: define a dónde puede exfiltrar datos o con qué APIs comunicarse un script inyectado. Con orígenes exactos el atacante solo tiene lo mínimo que la app necesita; con el comodín, toda la superficie de Google. Además, si una versión futura del SDK empieza a llamar a un dominio nuevo, la consola lo muestra (_Refused to connect_) y se revisa conscientemente, en lugar de pasar desapercibido bajo el comodín.
