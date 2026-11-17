# Stride Lab — documento maestro

> App de running personal (un solo usuario), PWA para iPhone.
> Este archivo es la fuente de verdad del repo: decisiones, pendientes y estado.

## Contexto (del documento maestro, aportado por el usuario el 2026‑11‑17)

- Reloj: **Apple Watch Ultra**. Fuente principal: **Apple Health**. Strava solo como apoyo.
- Solo entrenamientos de correr. Se descartan andar, senderismo, gimnasio, etc.
- Historial: **269 carreras** (2016 – nov 2026). Hasta 2022 solo distancia y ritmo.
  Desde 2023: pulso, potencia, zancada, oscilación vertical, contacto, temperatura y humedad.
- **2022 sin carreras y 2023 casi vacío (4)**: los gráficos muestran el hueco, no lo rellenan.
- ~186 carreras con GPX; ~56 indoor sin ruta.
- Uso personal: sin social, sin suscripciones, sin multiusuario.
- Fases posteriores (no ahora): Plan por turnos de 5 semanas; carga/fatiga/forma;
  predicción de marcas con indicador de confianza; sincronización automática.

## Estado

| Paso | Qué | Estado |
|---|---|---|
| 0 | Plan de archivos y esquema de BD | Aprobado 2026‑11‑17 |
| 1 | Esqueleto Next.js, diseño base, PWA, acceso privado, navegación inferior | **Hecho** |
| 2 | Esquema Drizzle + migración en Neon + primer acceso `/setup` | **Hecho** |
| 3 | Importador reanudable + pantalla de importación | **Hecho** (probado con export sintético) |
| 4 | Importación real desde el iPhone + comprobación 17‑oct‑2026 | **Hecho**: 256 válidas, 190 rutas, 413 lecturas de VO₂ máx.; 17‑oct exacta |
| 5 | Inicio, Actividad + Detalle de carrera, Análisis | **Hecho** |

Fuera de Fase 1: Plan, entrenador IA, predicciones, sincronización automática.

## Infraestructura

| Pieza | Estado |
|---|---|
| Repo GitHub `julen96fernandez-lab/Stride-lab` | Movido desde `julen8fernandez/stride-lab` (GitHub redirige). Rama de trabajo y de producción: `claude/zen-bohr-x7mnlm` |
| Proyecto Vercel `stride-lab` (equipo JULEN, `prj_ojARZfH5dDDjc2fwNplNqjyP6DVv`) | Enlazado al repo; cada push despliega a producción → https://stride-lab-gamma.vercel.app. La protección de despliegues de Vercel (Vercel Authentication) está activa: pide iniciar sesión en Vercel antes de ver la app |
| Neon `stride-lab` (`wild-art-15451340`, aws‑eu‑central‑1, PG 18, Free) | Creado desde Vercel → Storage; variables `DATABASE_URL*`/`PG*`/`POSTGRES_*` puestas por la integración |
| Blob `stride-lab` (`store_SrfwICCW7EpHKqFO`, **privado**, fra1) | Creado y conectado: `BLOB_READ_WRITE_TOKEN` |
| `AUTH_SECRET` | Creada (sensible, production + preview) |
| `SETUP_CODE` | **Pendiente: la crea el usuario** (ver abajo) |

### Variables de entorno

| Nombre | Quién | Para qué |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (+ `PG*`, `POSTGRES_*`) | Integración Neon | Conexión a la BD; `_UNPOOLED` para migraciones |
| `BLOB_READ_WRITE_TOKEN` | Almacén Blob | Subida del zip, lectura por rangos, GPX |
| `AUTH_SECRET` | Creada en el paso 3 | Firma de la cookie de sesión |
| `SETUP_CODE` | **Usuario** | Código que pide `/setup` una única vez. Valor libre (≥ 12 caracteres, que no sea la contraseña). Tras fijar la contraseña ya no sirve para nada y se puede borrar |

## Independencia

Repo, proyecto de Vercel, BD de Neon y Blob propios.
Nada de Horizonte ni de la app de limpieza (repos, proyectos, BD, variables, claves).

## Stack

- Next.js 16 (App Router; Cache Components y Partial Prefetching activados: las lecturas de
  BD van en componentes dentro de `<Suspense>` con `await connection()`), TypeScript,
  Tailwind CSS v4
- Neon Postgres + Drizzle ORM. Cliente `drizzle-orm/neon-serverless` (WebSocket, admite
  transacciones) en Vercel; `node-postgres` contra Postgres local en pruebas
- Migraciones: SQL generado por `drizzle-kit generate` en `drizzle/`; `scripts/migrate.mjs`
  las aplica antes de cada `next build` (tabla `_migrations`)
- Vercel Blob privado (zip y GPX)
- ECharts (gráficas), MapLibre GL + OpenFreeMap (mapas) — paso 5
- PWA: manifest, iconos, service worker que solo cachea estáticos
- Pruebas: Vitest (`npm test`; las del pipeline necesitan `TEST_DATABASE_URL`)

## Acceso privado

- Contraseña única, guardada como hash scrypt (`scrypt:N:salt:hash`) en `app_settings`.
- **Primer acceso `/setup`**: solo funciona mientras no hay contraseña. Pide `SETUP_CODE`,
  la contraseña (≥ 10 caracteres) y su confirmación; la guarda con
  `INSERT … ON CONFLICT DO NOTHING` (no puede sobrescribir) e inicia sesión. Después,
  `/setup` redirige siempre a `/login`, y `/login` manda a `/setup` si aún no hay contraseña.
- Cookie `sl_session` firmada con `AUTH_SECRET` (JWT HS256, 90 días, `HttpOnly`, `Secure`,
  `SameSite=Lax`). `src/proxy.ts` (antes `middleware`) protege todo salvo `/login`,
  `/setup`, estáticos, iconos, manifest y `sw.js`; `/api/*` sin sesión → 401.
- Un intento fallido (contraseña o código) espera 800 ms.
- Pendiente: cambiar la contraseña desde Perfil (con la actual).

## Diseño (tokens)

| Token | Valor |
|---|---|
| Fondo | `#0A0B09` + resplandor radial lima arriba (y otro tenue abajo) + grano sutil |
| Tarjeta | `#151712`, borde 1 px `rgba(255,255,255,.08)`, radio 26, degradado vertical sutil |
| Acento | `#C8F23A` (solo datos clave, gráficas, item activo) |
| Texto | `#F4F5EE`; secundario `#A9ACA2` |
| Tipos | Space Grotesk (números, títulos), Inter (resto) |

Barra inferior flotante de cristal, item activo en píldora lima. Entrada escalonada de
tarjetas, números que cuentan. 390 px, safe areas, objetivos de 44 px.
Si falta una métrica se muestra vacía (`—`), nunca inventada.

## Archivos (estado real)

```
docs/MASTER.md
drizzle/                         0000_init.sql, 0001_import_lease.sql (+ meta)
scripts/migrate.mjs              migraciones antes del build
scripts/make-icons.mjs           iconos PWA desde SVG
public/sw.js, public/icons/
src/proxy.ts                     protección de rutas
src/app/
  layout.tsx, globals.css, manifest.ts
  login/ (page, LoginForm, fields, actions)   setup/ (page, SetupForm)
  (app)/layout.tsx               barra inferior
  (app)/page.tsx                 Inicio (vacío hasta el paso 5)
  (app)/{plan,actividad,analisis,perfil}/page.tsx
  (app)/perfil/importar/         page.tsx + ImportFlow.tsx
  api/import/upload/route.ts     token de cliente para la subida por partes
  api/import/route.ts            crea la importación desde un zip ya en Blob
  api/import/blobs/route.ts      lista los zips ya subidos
  api/import/[id]/route.ts       estado
  api/import/[id]/step/route.ts  avanza la importación (maxDuration 300, trabaja 240 s)
src/components/ui/               primitives, TabBar, Logo, CountUp, Greeting
src/lib/
  auth/                          session (JWT), password (scrypt), store (app_settings)
  db/                            schema.ts, client.ts
  format.ts                      km, ritmo, duración… en es-ES (— si falta)
  upload/resumable.ts            subida por partes reanudable (lógica pura, probada)
  upload/blob-api.ts             implementación con @vercel/blob/client
  import/register.ts             crear/recuperar importación desde un blob
  import/
    zip.ts        directorio central por rangos (Zip64), stream de una entrada
    blob.ts       origen por rangos sobre Blob privado + subida de GPX
    scanner.ts    escáner de bytes con punto de reanudación seguro
    xml.ts        atributos, entidades y fechas de Apple
    units.ts      conversiones de unidades
    workout.ts    <Workout> de correr → carrera; VO₂ máx.
    gpx.ts        puntos, distancia, desnivel, Douglas–Peucker, polyline
    splits.ts     parciales por km
    classify.ts   duplicados, validez, sesión especial
    pipeline.ts   fases, puntos de control, reserva
    status.ts     vistas para la API/pantalla y carrera de comprobación
tests/                           units.test.ts, pipeline.test.ts, helpers/ (export sintético)
```

## Importador (implementado)

1. **Subida reanudable** (`src/lib/upload/resumable.ts`). El navegador sube el zip
   directo a Blob privado por partes de 8 MB (3 a la vez) con la API manual de multipart
   (`createMultipartUpload` / `uploadPart` / `completeMultipartUpload`), usando un token
   de cliente que da `POST /api/import/upload`. El `uploadId`, la clave y las partes
   confirmadas se guardan en `localStorage`: tras un corte, al volver a Perfil → Importar
   aparece «Continuar la subida» y, al elegir el mismo archivo (nombre, tamaño y fecha),
   solo se envían las partes que faltan. Cada petición tiene tiempo máximo (2 min por
   parte, 3 min para unir) y 3 intentos visibles. La pantalla muestra MB subidos, que
   faltan y total, y la parte en curso.
   **No hay callback de Blob hacia la app** (nada de `onUploadCompleted`): al terminar,
   el propio navegador llama a `POST /api/import`, que comprueba el zip con `head()` (y su
   tamaño) y crea la fila en `imports` (o devuelve la que haya a medias de ese zip).
   `GET /api/import/blobs` lista los zips ya en Blob: «Usar este zip» crea la importación
   sin volver a subirlo, y «Continuar» retoma una a medias.
2. **Proceso por tramos.** La pantalla llama en bucle a `POST /api/import/:id/step`. Cada
   llamada trabaja hasta 240 s, guarda punto de control y devuelve el estado; mientras,
   la pantalla consulta `GET /api/import/:id` cada 4 s para mostrar fase y progreso. Si la
   red o la función se cortan, se reintenta; si se cierra la pantalla, «Continuar» reanuda.
   La pantalla pide `wakeLock` para no apagarse. **Si nada cambia en 60 s** (subida,
   creación o proceso) aparece un aviso con «Reintentar la subida», «Reintentar» o
   «Continuar». Las fases sin bytes (series, rutas) emiten un latido de progreso.
3. **Fases** (`imports.phase`):
   - `index`: directorio central del zip por rangos. XML = el `.xml` más grande que no sea
     CDA (el nombre puede ir traducido: `exportación.xml`). GPX: todos los `.gpx`.
   - `workouts` (1.ª pasada): `<Workout>` de correr, `<Record …VO2Max>`, `<ExportDate>`.
     Lo que no es `HKWorkoutActivityTypeRunning` se descarta sin parsear.
   - `samples` (2.ª pasada): `<Record>` de FC, potencia, velocidad y distancia **del mismo
     `sourceName` que la carrera** y dentro de su ventana (así no se cuentan las del iPhone).
     Hacen falta dos pasadas porque los `<Workout>` van al final del XML.
   - `series`: fusiona las muestras (`import_samples`) en `run_series`.
   - `routes`: GPX por `<FileReference>`; los GPX sin referencia se enlazan por solapamiento
     de hora (prioridad Apple Watch, no indoor). Original a Blob (`routes/<run>.gpx`),
     polyline simplificada (4 m), bbox, desnivel, y parciales.
   - `finalize`: parciales de las carreras sin GPX (cinta) desde la distancia del reloj;
     deduplicado y clasificación sobre **todas** las carreras; contadores.
4. **Puntos de control.** Las pasadas guardan el byte del XML descomprimido ya procesado.
   Al reanudar se descomprime de nuevo y se salta hasta ahí (descomprimir es muy rápido).
   Los resultados y el punto de control se guardan en la misma transacción cada 30 s.
   Cada invocación avanza al menos un elemento/lote (evita bucles sin progreso).
5. **Reserva.** `imports.lease_until` impide que dos invocaciones procesen a la vez.
6. **Mapeo de la carrera**: primera aparición de cada `WorkoutStatistics`
   (`DistanceWalkingRunning` sum, `HeartRate` average/maximum, `RunningPower`,
   `RunningSpeed`, `RunningStrideLength`, `RunningVerticalOscillation`,
   `RunningGroundContactTime`, `StepCount` → cadencia, `ActiveEnergyBurned`) y metadatos
   `HKElevationAscended`, `HKWeatherTemperature` (°F→°C), `HKWeatherHumidity`
   («7200 %» = 72 %), `HKIndoorWorkout`. Si no hay estadística de distancia se usa el
   atributo antiguo `totalDistance` si existe (queda anotado en `raw.distanceFrom`); si no,
   la distancia queda vacía.
7. **Parciales**: por defecto desde la distancia del reloj (`basis='samples'`, coincide con
   la distancia oficial); si no hay muestras, desde el GPX (`basis='gpx'`). FC y potencia
   medias del tramo; desnivel del GPX. Último parcial si ≥ 50 m.
8. **Reglas**: duplicada = otra fuente que empieza a ≤ 30 min de una de Apple Watch;
   válida = no duplicada y ≥ 0,5 km; especial = ritmo medio > 8:00 /km (válida, fuera de
   los ritmos medios).
9. **Idempotencia**: `source_key` = `sourceName|inicio|fin` (UTC), upserts en todo; VO₂ por
   (`measured_at`, `source_name`); rutas por carrera.

Rendimiento medido en local con 400 MB de XML sintético: 1.ª pasada ~430 MB/s, 2.ª pasada
(peor caso) ~230 MB/s. Para 3,7 GB se esperan del orden de 1–2 min por pasada en Vercel;
aunque tardara más, se reanuda sola.

## Esquema de base de datos

Ver `src/lib/db/schema.ts` (fuente de verdad) y `drizzle/*.sql`. Tablas:
`app_settings`, `imports` (+ `lease_until`), `shoes`, `runs`, `run_routes`, `run_splits`
(+ `basis`), `run_series` (hr | power | speed | distance), `import_samples` (temporal
durante la importación), `vo2max_readings`.

Durabilidad (primera vs segunda mitad: ritmo, FC y desacople) se calculará al vuelo en
el paso 5 desde `run_splits`/`run_series`.

"Ritmo a igual FC por año": válidas, no especiales, ≥ 5 km, con FC; franja
**140–150 ppm** (ajustable), mostrando cuántas carreras entran cada año.

## Pantallas (paso 5)

Todas leen de Neon en servidor (`src/lib/db/queries.ts`) dentro de `<Suspense>`; donde
falta un dato se muestra «—» o un texto de «sin datos», nunca un valor estimado.

- **Inicio**: VO₂ máx. actual con tendencia de 14 meses (línea con degradado, punto final
  con halo, tooltip táctil) y diferencia frente al pico del periodo; últimos 28 días
  (distancia, ritmo medio sin sesiones especiales, tiempo, FC media ponderada por tiempo);
  volumen de 12 meses por mes; última carrera con miniatura de la ruta.
- **Actividad**: carreras válidas agrupadas por mes (miniatura SVG de la ruta generada en
  servidor, distancia, ritmo, tiempo, FC, etiquetas Cinta/Especial/Strava) y recuento de
  duplicadas y no válidas ocultas.
- **Detalle** (`/actividad/[id]`): distancia, tiempo, ritmo, FC; mapa (ruta en SVG siempre
  visible + MapLibre con OpenFreeMap `dark` encima si cargan las teselas; gestos
  cooperativos para no atrapar el scroll); parciales por km (barra más larga = más rápido,
  el más rápido en lima, FC y desnivel por km); durabilidad; gráficas de pulso y potencia
  (una por medida, sin doble eje); métricas de técnica y entorno; anterior/siguiente.
- **Análisis**: VO₂ máx. de todo el historial (media por día, zoom y arrastre táctil);
  ritmo con el mismo pulso por año (franja 140–150 por defecto, botones 130–140 … 150–160
  vía `?fc=`), con nº de carreras y FC media por año y años vacíos visibles; km por año
  con los años sin carreras como hueco y listados debajo; totales.

Durabilidad (`src/lib/analysis/durability.ts`): se parte la carrera por la mitad de la
distancia (con la distancia del reloj; si no hay, con los parciales). Ritmo y FC media de
cada mitad; desacople = caída de (velocidad / FC) de la 1.ª a la 2.ª mitad en %. Sin FC,
el desacople queda vacío.

Ritmo a igual FC (`src/lib/analysis/pace-at-hr.ts`): tiempo total / distancia total de las
carreras del año que cumplen la regla; FC media ponderada por tiempo.

## Riesgos y pendientes

- La 1.ª importación real dirá si el formato del export coincide con lo esperado
  (nombres localizados, `FileReference`, unidades). La pantalla muestra el error exacto
  si algo falla y se puede reanudar.
- Neon Free: 0,5 GB de almacenamiento; las series ocupan poco (estimado < 50 MB).
- Cambiar contraseña desde Perfil.
- Zona horaria: se guarda en UTC; se muestra en Europe/Madrid.

## Incidencias

- **2026‑11‑17 · Subida parada al 99 %, sin fila en `imports`.** Diagnóstico: el almacén
  Blob registraba 0 archivos (en multipart el archivo solo existe tras unir las partes);
  no intervenía ningún callback de Blob (no se usaba `onUploadCompleted`), así que
  Deployment Protection no era la causa. El 99 % significaba «todo enviado, esperando la
  última parte o la unión»: el SDK reintenta en silencio hasta 10 veces con espera
  creciente (~17 min) y sin tiempo máximo, y `POST /api/import` nunca llegó a llamarse.
  Solución: subida propia reanudable con tiempos máximos y reintentos visibles, creación
  de la importación desde el navegador o desde un zip ya subido, y aviso de parada a 60 s.

## Comprobación con datos reales

Carrera del 17‑oct‑2026: 21,34 km · 1:41:41 · 4:46 /km · FC 156 · 252 W.
Al terminar la importación, la pantalla compara esa carrera con estos valores.

## Registro de cambios

- 2026‑11‑17 — Plan inicial de Fase 1 (archivos, esquema, importador).
- 2026‑11‑17 — Plan aprobado. Decididos: contraseña única (90 días), Hobby → importación
  reanudable, regla de carrera válida, franja 140–150 ppm. Contexto del documento maestro.
- 2026‑11‑17 — Paso 1: esqueleto Next 16 + Tailwind 4, diseño dark, barra inferior,
  pantallas vacías, login, PWA. Comprobado en local a 390 px.
- 2026‑11‑17 — Infraestructura: repo movido a `julen96fernandez-lab`; proyecto Vercel,
  Neon (Fráncfort) creados por el usuario; Blob privado y `AUTH_SECRET` creados.
- 2026‑11‑17 — Paso 2: esquema y migraciones (aplicadas en Neon); contraseña en BD;
  pantalla `/setup` con `SETUP_CODE`. Probado en local de punta a punta.
- 2026‑11‑17 — Paso 3: importador reanudable (zip por rangos, escáner en streaming, dos
  pasadas, series, rutas, parciales, deduplicado, clasificación, reserva) y pantalla de
  importación con progreso y comprobación. 18 pruebas con export sintético, incluida la
  reanudación tras cortes en cualquier punto y la reimportación sin duplicados.
- 2026‑11‑17 — Importación real hecha por el usuario: 256 válidas, 190 rutas GPX, 413
  lecturas de VO₂ máx.; comprobación del 17‑oct correcta.
- 2026‑11‑17 — Paso 5: Inicio, Actividad, Detalle de carrera y Análisis con datos reales;
  ECharts (SVG) y MapLibre. 29 pruebas (5 nuevas de durabilidad y ritmo a igual FC).
- 2026‑11‑17 — Arreglo de la subida (ver Incidencias): subida por partes reanudable,
  «Continuar la subida», MB subidos/que faltan, lista de zips ya subidos, creación de la
  importación sin callbacks, aviso con «Reintentar/Continuar» tras 60 s sin cambios.
  24 pruebas (5 nuevas de subida y 1 de creación desde un zip existente) y prueba en
  navegador con Blob simulado: corte, recarga, reanudación enviando solo la parte que
  faltaba.
