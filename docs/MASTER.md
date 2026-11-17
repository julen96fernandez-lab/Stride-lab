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
| 2 | Esquema Drizzle + migración en Neon (proyecto nuevo) | — |
| 3 | Importador (librería + pruebas con export sintético) | — |
| 4 | Pantalla de importación (subida a Blob + proceso en streaming + progreso) | — |
| 5 | Inicio, Actividad + Detalle de carrera, Análisis | — |
| 6 | Importación real + comprobación 17‑oct‑2026 | — |

Fuera de Fase 1: Plan, entrenador IA, predicciones, sincronización automática.

## Infraestructura (estado)

| Pieza | Estado |
|---|---|
| Repo GitHub `julen8fernandez/stride-lab` | Creado |
| Proyecto Vercel `stride-lab` (equipo JULEN) | **Pendiente (acción del usuario):** la app de GitHub de Vercel no tiene acceso al repo (`repo_no_access`) |
| Neon `stride-lab` (Fráncfort) | **Pendiente (acción del usuario):** la organización de Neon está gestionada por Vercel; la API de Neon no deja crear proyectos y hay que crearlo desde Vercel → Storage |
| Blob `stride-lab` (privado, fra1) | Pendiente: se crea y conecta con el proyecto de Vercel |
| Variables `AUTH_SECRET`, `AUTH_PASSWORD_HASH` | Pendiente: se configuran en el proyecto de Vercel |

## Independencia

Repo `stride-lab` propio, proyecto de Vercel propio y proyecto de Neon propio.
Nada de Horizonte ni de la app de limpieza (repos, proyectos, BD, variables, claves).

## Stack

- Next.js 16 (App Router, Cache Components y Partial Prefetching activados por defecto:
  las lecturas de BD irán dentro de `<Suspense>`) + TypeScript + Tailwind CSS v4
- Neon Postgres + Drizzle ORM (`@neondatabase/serverless`)
- Vercel Blob (zip original y GPX individuales)
- ECharts (gráficas), MapLibre GL + teselas OpenFreeMap (sin clave) para mapas
- PWA instalable: `manifest.webmanifest`, iconos, service worker mínimo
- Pruebas: Vitest

## Acceso privado (implementado)

Un único usuario con contraseña. Hash en `AUTH_PASSWORD_HASH` (formato
`scrypt:N:salt:hash`, se genera con `npm run hash-password -- '<contraseña>'`). Cookie de
sesión `sl_session` firmada con `AUTH_SECRET` (JWT HS256, 90 días, `HttpOnly`, `Secure` en
producción, `SameSite=Lax`). `src/proxy.ts` (en Next 16 `middleware` pasa a llamarse
`proxy`) protege todo salvo `/login`, estáticos, iconos, manifest y `sw.js`; las rutas
`/api/*` sin sesión devuelven 401. Login y logout son server actions (`src/app/login/actions.ts`);
un fallo de contraseña espera 800 ms.

## Diseño (tokens)

| Token | Valor |
|---|---|
| Fondo | `#0A0B09` + resplandor radial lima arriba (y otro tenue abajo) + grano sutil |
| Tarjeta | `#151712`, borde 1 px `rgba(255,255,255,.08)`, radio 24–28, degradado vertical sutil |
| Acento | `#C8F23A` (solo datos clave, gráficas, item activo) |
| Texto | `#F4F5EE`; secundario `#A9ACA2` |
| Tipos | Space Grotesk (números, títulos), Inter (resto) |

Barra inferior flotante de cristal, item activo en píldora lima. Entrada escalonada de
tarjetas, números que cuentan. 390 px, safe areas, objetivos de 44 px.
Si falta una métrica se muestra vacía (`—`), nunca inventada.

## Plan de archivos

```
docs/MASTER.md
.env.example                       DATABASE_URL, BLOB_READ_WRITE_TOKEN, AUTH_SECRET, AUTH_PASSWORD_HASH
drizzle.config.ts
drizzle/                           migraciones SQL generadas
public/manifest.webmanifest, icons/, sw.js
scripts/hash-password.ts           genera AUTH_PASSWORD_HASH
src/middleware.ts
src/app/
  layout.tsx, globals.css          fuentes, tokens, fondo con resplandores y grano
  login/page.tsx
  (app)/layout.tsx                 barra inferior flotante
  (app)/page.tsx                   Inicio
  (app)/plan/page.tsx              "Próximamente"
  (app)/actividad/page.tsx         lista de carreras
  (app)/actividad/[id]/page.tsx    Detalle de carrera
  (app)/analisis/page.tsx          Análisis
  (app)/perfil/page.tsx            ajustes, zapatillas (vacío), cerrar sesión
  (app)/perfil/importar/page.tsx   subida del zip + progreso + resumen
  api/auth/login|logout/route.ts
  api/import/upload/route.ts       token de subida cliente → Blob (multipart)
  api/import/[id]/process/route.ts procesa en streaming (maxDuration)
  api/import/[id]/route.ts         estado del trabajo (polling)
src/components/
  ui/        Card, Stat, CountUp, Section, TabBar, Empty
  charts/    EChart (wrapper cliente), Vo2Chart, YearKmBars, PaceAtHrChart, SplitsChart
  map/       RouteMap (MapLibre, carga dinámica)
src/lib/
  auth/      session.ts, password.ts
  db/        client.ts, schema.ts, queries/{runs,analysis,vo2}.ts
  format.ts  ritmo, duraciones, números es-ES, zona Europe/Madrid
  import/
    remote-zip.ts    lector de zip por peticiones Range sobre la URL de Blob
    xml-scanner.ts   escáner en streaming de export.xml (por elementos, sin cargar el XML)
    health-types.ts  constantes HK*
    workout.ts       <Workout> → carrera (estadísticas, metadatos, unidades)
    samples.ts       buffers compactos (Float64Array) de FC, potencia y distancia
    gpx.ts           parseo GPX, distancia, parciales, simplificación, polyline
    dedupe.ts        Strava vs Apple Watch (30 min, prioridad Watch)
    classify.ts      validez y "sesión especial" (> 8:00 /km)
    pipeline.ts      orquestación, idempotencia, upserts, progreso
  analysis/  splits.ts, durability.ts, pace-at-hr.ts
tests/       vitest + fixtures/ export sintético mínimo (nunca datos reales)
```

## Importador: diseño

1. **Subida.** El navegador sube el zip (~200 MB) directamente a Vercel Blob con
   `upload()` de `@vercel/blob/client` (multipart). El archivo no pasa por la función
   ni por GitHub. Se crea una fila en `imports`.
2. **Lectura del zip sin descargarlo entero.** `remote-zip.ts` lee el directorio central
   del zip con peticiones HTTP Range y abre por separado `export.xml` y cada
   `workout-routes/*.gpx`.
3. **XML en streaming.** `export.xml` (~3,7 GB) se descomprime como stream (zlib) y pasa
   por un escáner que solo materializa los elementos útiles:
   - `<Record type="HKQuantityTypeIdentifierVO2Max">` → `vo2max_readings`.
   - `<Record>` de FC, potencia, distancia, velocidad… → buffers compactos en memoria
     (tiempo + valor) para recortar después por ventana de cada carrera.
     Motivo: en el export los `<Workout>` van al final, después de los `<Record>`.
   - `<Workout workoutActivityType="HKWorkoutActivityTypeRunning">` → carrera.
     Cualquier otro tipo se descarta sin parsear.
4. **Mapeo de la carrera** (primera aparición de cada `WorkoutStatistics`):
   - distancia: `DistanceWalkingRunning` `sum` (km) — no se usa el atributo de `<Workout>`;
   - FC media/máx.: `HeartRate` average/maximum; potencia: `RunningPower` average;
     velocidad: `RunningSpeed` average; zancada: `RunningStrideLength`;
     oscilación vertical: `RunningVerticalOscillation`; contacto: `RunningGroundContactTime`;
     pasos: `StepCount` sum → cadencia = pasos / minutos;
   - metadatos: `HKElevationAscended` (desnivel), `HKWeatherTemperature`,
     `HKWeatherHumidity`, `HKIndoorWorkout`; todo se guarda también en `raw` (JSONB).
5. **GPX.** Enlace por `<FileReference>` del propio Workout si existe; si no, por
   solapamiento de hora de inicio/fin. El GPX original se sube a Blob; en Neon se guarda
   una polyline simplificada, bbox y los parciales por km.
6. **Deduplicado.** Carreras con inicio a menos de 30 min y una de ellas de Strava:
   se conserva la de Apple Watch; la otra queda con `status='duplicate'` y `duplicate_of`.
7. **Sesión especial.** Ritmo medio > 8:00 /km → `is_special=true` (series o mixtas),
   excluida de los ritmos medios.
8. **Idempotencia.** Clave natural `source_key` = fuente + inicio + fin (UTC). Todo son
   upserts; reimportar el mismo zip (o uno más nuevo) no duplica nada.
9. **Progreso.** La función actualiza `imports` (fase, bytes leídos, contadores); la
   pantalla consulta cada 2 s.

**Reanudable desde el principio (Vercel Hobby, 300 s por invocación).** No se depende de
que todo quepa en un proceso. El diseño concreto (pasadas/lotes con punto de control en
`imports`) se fija en el paso 3.

## Esquema de base de datos (Postgres / Drizzle)

```sql
imports (
  id               uuid pk,
  blob_url         text not null,
  blob_pathname    text not null,
  file_size        bigint,
  export_date      timestamptz,           -- <ExportDate> del XML
  status           text not null,         -- uploaded | processing | done | failed
  phase            text,                  -- zip | xml | routes | dedupe | done
  bytes_processed  bigint default 0,
  stats            jsonb,                 -- contadores: carreras, descartes, GPX, VO2…
  error            text,
  created_at, started_at, finished_at timestamptz
)

shoes (
  id uuid pk, name text not null, brand text, model text,
  purchased_at date, retired_at date,
  initial_km numeric(7,2) default 0, notes text,
  created_at timestamptz
)

runs (
  id                     uuid pk,
  source_key             text unique not null,    -- idempotencia
  source                 text not null,           -- apple_watch | strava | other
  source_name            text, source_version text, device text,
  start_at               timestamptz not null,
  end_at                 timestamptz not null,
  duration_s             real not null,
  distance_m             real,                    -- null si no hay estadística
  avg_pace_s_per_km      real,                    -- derivado
  avg_hr                 real, max_hr real,
  avg_power_w            real,
  avg_speed_mps          real,
  avg_stride_m           real,
  avg_vertical_osc_cm    real,
  avg_ground_contact_ms  real,
  steps                  integer,
  cadence_spm            real,                    -- derivado de pasos
  elevation_gain_m       real,
  temperature_c          real,
  humidity_pct           real,
  is_indoor              boolean,
  active_energy_kcal     real,
  status                 text not null default 'valid',  -- valid | invalid | duplicate
  invalid_reason         text,
  duplicate_of           uuid references runs(id),
  is_special             boolean not null default false,  -- > 8:00 /km
  shoe_id                uuid references shoes(id),
  import_id              uuid references imports(id),
  raw                    jsonb,                   -- metadatos y estadísticas originales
  created_at, updated_at timestamptz
)
index runs(start_at desc); index runs(status, is_special)

run_routes (
  run_id         uuid pk references runs(id) on delete cascade,
  blob_url       text not null,       -- GPX original
  file_name      text not null,
  point_count    integer,
  polyline       text,                -- simplificada, para mapa y miniatura
  min_lat, min_lon, max_lat, max_lon  double precision,
  gpx_distance_m real,
  gpx_elevation_gain_m real
)

run_splits (
  run_id         uuid references runs(id) on delete cascade,
  idx            smallint,            -- km 1, 2, …; el último puede ser parcial
  distance_m     real, duration_s real, pace_s_per_km real,
  avg_hr         real, avg_power_w real,
  elevation_gain_m real, elevation_loss_m real,
  primary key (run_id, idx)
)

run_series (
  run_id   uuid references runs(id) on delete cascade,
  metric   text,                      -- hr | power | speed | distance | elevation
  t        integer[],                 -- segundos desde el inicio
  v        real[],
  primary key (run_id, metric)
)

vo2max_readings (
  id           uuid pk,
  measured_at  timestamptz not null,
  value        real not null,         -- mL/(kg·min)
  source_name  text,
  import_id    uuid references imports(id),
  unique (measured_at, source_name)
)
```

Durabilidad (primera vs segunda mitad: ritmo, FC y desacople ritmo/FC) se calcula al
vuelo desde `run_series`/`run_splits`; no se guarda.

"Ritmo a igual FC por año": carreras válidas, no especiales, ≥ 5 km, con FC; ritmo
medio por año en la franja **140–150 ppm** (ajustable), mostrando cuántas carreras entran
cada año (decidido).

## Riesgos y decisiones abiertas

- **Tiempo de función.** Plan Hobby: 300 s máx. por invocación → importación por lotes
  reanudable (decidido).
- **Privacidad de Blob.** Datos de salud: usar almacenamiento privado de Blob si está
  disponible en la cuenta; si no, rutas con sufijo aleatorio no adivinable y nunca
  enlazadas públicamente.
- **Carrera válida (decidido):** no duplicada (ventana 30 min, gana Apple Watch) y
  distancia ≥ 0,5 km. Salen ~251 de 269. Sesión especial (> 8:00 /km) sigue siendo válida
  pero queda fuera de los ritmos medios.
- **Zona horaria.** Se guarda en UTC; se muestra en Europe/Madrid.

## Comprobación con datos reales

Carrera del 17‑oct‑2026: 21,34 km · 1:41:41 · 4:46 /km · FC 156 · 252 W.
La pantalla de importación mostrará esta carrera al terminar para verificarla.

## Registro de cambios

- 2026‑11‑17 — Plan inicial de Fase 1 (archivos, esquema, importador).
- 2026‑11‑17 — Plan aprobado. Decididos: contraseña única (90 días), Hobby → importación
  reanudable, regla de carrera válida, franja 140–150 ppm. Añadido el contexto del
  documento maestro.
- 2026‑11‑17 — Paso 1: esqueleto Next 16 + Tailwind 4, tokens de diseño dark (resplandor
  lima, grano, tarjetas), Space Grotesk + Inter, barra inferior flotante de cristal,
  pantallas vacías (sin datos inventados), login con contraseña, PWA (manifest, iconos,
  service worker que solo cachea estáticos). Comprobado en local a 390 px: redirección a
  login, 401 en API, error de contraseña, cookie de 90 días, logout.
