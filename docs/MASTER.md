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

## Objetivos y volumen por periodo

- **Objetivos** (Perfil → Objetivos de kilómetros; `app_settings` `km_goals`): km por semana,
  mes y año, cada uno opcional (vacío = sin objetivo) y con «Pausar». Sugerencias desde los
  últimos 12 meses: media semanal (km/52,14), media mensual (km/12) y total.
- **Inicio**: tarjeta con anillo de progreso de la semana y del mes: km hechos / objetivo,
  km que faltan y km por día necesarios (días que quedan, hoy incluido). Sin objetivos
  activos, un enlace a Perfil.
- **Análisis → Volumen** (`src/lib/analysis/periods.ts`): selector Semana (12 o 26) / Mes
  (12) / Año (desde la primera carrera). Barras de km con el periodo actual resaltado y la
  línea discontinua del objetivo (si lo hay; el eje se estira para que se vea); debajo,
  alineado y con el mismo eje X, el ritmo medio (eje invertido: arriba = más rápido). Son
  dos gráficos y no uno con dos escalas, a propósito. Tocar una columna muestra km,
  carreras, ritmo, tiempo, FC media, desnivel, carga y tiempo en cada zona. Comparación con
  el periodo anterior (km y ritmo; el actual «hasta hoy»).
- Semanas de lunes a domingo en hora de Madrid. Km: todas las válidas; ritmo medio sin
  sesiones especiales; FC ponderada por tiempo; periodos sin carreras a 0 (sin rellenar).

## Análisis: tipos, ritmo, constancia y años

Cálculos en `src/lib/analysis/insights.ts` (y `kmByType` en `periods.ts`), con pruebas.
- **Volumen → Total / Por tipo** (semana y mes): barras apiladas por tipo de sesión con
  los colores de los tipos (orden fijo; «sin tipo» en gris), leyenda con icono. En la vista
  semanal, **media móvil de 4 semanas** (línea; solo cuando hay 4 semanas completas de datos
  en la ventana, sin inventar las primeras). El detalle del periodo lista km por tipo.
- **Evolución del ritmo**: un punto por carrera (color de su tipo) y tendencia suavizada
  (núcleo gaussiano en el tiempo, ancho = 1/6 del intervalo, mínimo 5 días; con < 3
  carreras no hay tendencia). Rangos 1 mes / 3 / 6 / 1 año / Todo (`?rango=`) y tipo
  (`?rtipo=`). Sin sesiones especiales. Tocar un punto muestra la carrera y enlaza a ella.
- **Constancia · 12 meses**: un cuadrado por día (columnas = semanas lun→dom), intensidad
  por cuartiles de km o de carga (`?cal=carga`), gris = sin correr (o sin carga). Tocar un
  día lista sus carreras.
- **Año actual frente al anterior**: km acumulados día a día (actual hasta hoy, anterior
  completo, discontinuo) y tabla del 1 de enero hasta hoy frente al mismo tramo del año
  pasado: km, horas, desnivel, carreras y ritmo medio (sin especiales).

## Inicio (rediseño del 18‑nov)

Orden: banda «Modo lesión» (si hay un periodo abierto) → **Hoy** → **Esta semana** → **Este
mes** → **Última carrera** → Últimos 28 días (distancia y ritmo) → Km por tipo → Récords de los
últimos 12 meses → Eficiencia aeróbica (rodajes, Z2) → VO₂ máx. Botón «+» fijo para añadir
carrera. Los km por mes de 12 meses salen de Inicio (están en Análisis → Volumen).
- **Hoy** (`src/lib/analysis/home.ts`, con pruebas): recomendación provisional por reglas
  prudentes, siempre «estimación, no un plan». Lesión abierta → Descanso; ya corrido hoy →
  Descanso; tres días seguidos → Descanso; ayer competición → Descanso; ayer series o tirada
  larga → Rodaje suave (Descanso si la carga fue ≥ 1,5× la media de las carreras de los 28
  días anteriores, con al menos 3 de referencia); ayer carga alta → Rodaje suave; hace 2 días
  sesión exigente o carga alta → Rodaje suave; ≥ 10 días sin correr → Rodaje suave;
  descansado y sin calidad (series, tempo, competición) en 4 días → Calidad; si no, Libre.
  Sin pulso no se compara la carga.
- **Semana**: lunes a domingo (Madrid), un círculo por día (km, descanso, hoy, por llegar),
  anillo del objetivo semanal y km que faltan.
- **Mes**: anillo del objetivo y comparación con el mismo tramo del mes pasado (sin lesión;
  si hay carreras en lesión, el texto lo dice).

## Carreras añadidas a mano

Botón «Añadir carrera» en Actividad y en Perfil → Importar (`/actividad/nueva`; edición en
`/actividad/[id]/editar`, solo origen `manual`). Formulario para el iPhone: fecha y hora,
distancia y duración (h:min:s) obligatorias; pulso medio/máximo, desnivel, cadencia, potencia,
temperatura, tipo (automático por defecto), nota y «Cinta / indoor» opcionales. «Ver resumen»
muestra ritmo, tipo que saldría, carga y sesión especial, y avisa de carreras a ≤ 30 min (hay
que marcar «guardarla igualmente»). Errores campo a campo en español.
- Archivo opcional .gpx/.tcx/.fit (`src/lib/import/activity-file.ts`, sin dependencias; el
  FIT se decodifica a mano: mensajes record y session, marcas de tiempo comprimidas, campos
  de desarrollador). Se lee en el móvil para rellenar el formulario y en el servidor para
  guardar: series (distancia por intervalos, pulso, potencia) en el mismo formato que el zip,
  ruta (GPX en Blob), pista con altitud, parciales, zonas, carga, récords y ritmo en Z2. Límite
  4 MB (Vercel).
- Sin archivo: ni series, ni gráficos, ni tiempo en zonas. Con pulso medio, carga **estimada**
  (todo el tiempo en la zona del pulso medio), marcada «≈ estimada»; `reclassifyAll` la
  conserva y la reestima si cambian las zonas.
- Al guardar se recalcula solo esa carrera (`src/lib/manual/manual-db.ts`): tipo con
  `classifyCandidate` (mismas reglas, zonas y media de 12 meses), zonas, carga, récords, Z2 y
  lesiones. Objetivos y gráficos se calculan al vuelo.
- Import del zip: en la fase final, antes de deduplicar, `replaceManualRuns` sustituye cada
  manual con pareja (mismo día de Madrid, inicio a < 30 min, distancia ±5 %; primero contra
  el Apple Watch y luego contra otras fuentes). La del zip conserva tipo manual, nota y calzado
  de la manual. Las manuales nunca se marcan como duplicadas ni se unen con otras. El resumen
  del import muestra «Carreras manuales sustituidas por el zip».

## Series y eficiencia aeróbica

**Series** (`src/lib/analysis/intervals.ts`, sección en el detalle de carreras de tipo Series):
los pasos del reloj son `WorkoutEvent`/`WorkoutActivity` con `WOIntervalStepKeyPath`
«bloque.repetición.fase». El importador ahora guarda `raw.intervalEvents` (clave, inicio y
duración; `src/lib/import/interval-events.ts`). Las carreras importadas antes solo tienen las
claves: hasta pulsar **Reprocesar** (Perfil → Importar datos) la sección explica que faltan las
horas. En un bloque con repeticiones, fase 0 = trabajo y fase 1 = recuperación; se comprueba
con el ritmo (si el trabajo no es más rápido, no se separa y se dice por qué). Tabla con
calentamiento, repeticiones, recuperaciones intercaladas y enfriamiento (distancia, tiempo,
ritmo, FC media y máxima; en recuperaciones, bajada de pulso desde el final de la repetición
anterior), barras con el ritmo de cada repetición y la media de trabajo, caída de ritmo de la
1.ª a la última (%) y recuperación media de pulso. Tocar una repetición la resalta en mapa y
gráficos.

**Desacople aeróbico** (`src/lib/analysis/efficiency.ts`): solo en Rodaje y Tirada larga con
pulso, ≥ 4 km completos y variación del ritmo de los parciales ≤ 5 % (coeficiente de
variación). Si no, la tarjeta de mitades se queda sin el % y dice por qué.

**Eficiencia aeróbica**: por carrera, ritmo medio (por distancia) de los instantes con pulso en
Z2 (de las zonas guardadas; 131–144 con 47/187), con ≥ 5 min en Z2 y la línea de tiempo del
detalle (sin pausas ni muestras inválidas). Columnas `runs.ef_z2_*` (migración 0007),
recalculadas en `reclassifyAll` (reglas versión 9). En Análisis: puntos de los últimos 6 meses
con tendencia suavizada (sin lesiones), filtro Rodaje / Todas.

## Detalle de carrera: mapa y gráficos sincronizados

`src/components/charts/RunExplorer.tsx` + lógica pura en `src/lib/analysis/run-stream.ts` (con
pruebas). Debajo del mapa, gráficos apilados y alineados (mismo margen izquierdo/derecho) en
el eje de distancia o tiempo (selector): **ritmo** (suavizado ~30 s, ritmo medio como línea de
referencia), **pulso** con las bandas de las zonas de fondo, **altitud** y **potencia**. Solo
se dibuja el gráfico de una serie que existe. **Cadencia**: no hay serie guardada (solo la
media en 92 carreras); para dibujarla habría que reimportar con los pasos por intervalo.
- Línea de tiempo común: rejilla de ~3 s (≤ 1500 puntos); cada serie se interpola y deja un
  hueco donde no tiene muestras cerca (nada se inventa).
- Ritmo: mismas reglas de validez que los récords (`continuousSegments`: pausas y muestras
  imposibles parten la carrera; la ventana nunca cruza un corte; < 0,66 m/s = parado, sin
  ritmo). Carreras antiguas con muestras de distancia cada > 60 s: ritmo por parciales
  (escalera), no curva.
- GAP (interruptor): coste de Minetti (2002) con la pendiente en ±50 m de distancia; solo con
  altitud del GPX.
- Cursor: una capa transparente recoge el dedo (touch-action: pan-y; el scroll vertical sigue
  funcionando), y con requestAnimationFrame mueve una sola línea vertical por todos los
  gráficos, el punto del mapa (Marker de MapLibre) y la tarjeta fija (distancia, tiempo,
  ritmo, pulso, altitud, zona, y GAP/potencia si hay) sin re-renderizar React. 60 fps con la
  CPU 4× más lenta.
- Parciales por km: km, tiempo, ritmo con barra relativa, FC y desnivel; más rápido y más
  lento marcados (ninguno si todos van al mismo segundo; el último incompleto no compite).
  Tocar uno lo resalta en todos los gráficos y en el mapa.
- Dibujo (versión del 18‑nov): líneas de 2 px redondeadas y suaves, rellenos con degradado
  transparente (`alpha(var(--x),0.3)` en EChart.tsx), rejilla muy tenue, sin fondos grises,
  animación de entrada (las actualizaciones no la repiten: `merge`). Cursor: línea fina color
  acento, punto con brillo sobre cada gráfico y tarjeta flotante con desenfoque junto al dedo.
  - Ritmo: mediana (7) + media (5) sobre la media de ~30 s; nada más rápido de 2:30 /km; eje
    entre los percentiles 5 y 95 de la carrera, marcas cada 30 s o 1 min; el medio va en la
    cabecera (no lo tapa el cursor). Ajustado por pendiente: línea fina y suave.
  - Pulso: las muestras tal cual, unidas solo si están a < 2 min (con puntos pequeños si hay
    ≤ 600), color por zona. Si cubren menos de la mitad de la carrera (o hay < 30), barras por
    parcial con el pulso medio de cada km, del color de su zona.
  - Altitud: hueco de la pista rellenado hasta 10 min (sin cortes), suavizada, con degradado
    vertical y color por pendiente (bajada azul, llano neutro, subida ámbar/roja).
  - Franja fija encima de los gráficos (sticky) con ritmo, km, tiempo, pulso + zona, altitud
    y potencia; sobre los gráficos solo el punto con brillo (la tarjeta flotante tapaba datos).
  - Ritmo continuo (`fillPace`): donde el reloj no tiene ritmo se usa el del GPS (mismo
    suavizado) o, sin GPS, el del parcial o la muestra anterior (escalera). Solo hay hueco en
    pausas reales: pausas del reloj guardadas al importar (`raw.pauses`, eventos Pause/Resume y
    MotionPaused/Resumed; hace falta Reprocesar) o, con GPS, donde el GPS está parado. Las
    pausas se unen con un punteado muy fino sin texto. Una sola nota bajo los gráficos
    («Ritmo estimado con GPS en X tramos»). Parciales que tocan tramos sin distancia del reloj:
    ritmo recalculado con el GPS (o mejor estimación sin GPS) y marcado «≈».
  - Pulso por parciales: eje desde 60 ppm (marcas cada 20) y barra discontinua tenue en los
    parciales sin pulso.
  - Eje de km: la suma de muestras del reloj, salvo que se desvíe > 2 % del total y el GPS no
    (entonces la distancia del GPS). En 88 de 187 carreras con ruta las muestras no cuadran
    con el total; en el 4‑jul suman 20,65 km (el GPS 21,31; el total 21,38): el reloj no
    registró distancia en 5 tramos donde el GPS sí marca movimiento. Un texto bajo los
    gráficos lo explica.
  - Franja: si en ese instante no hay pulso, la muestra más cercana a ≤ 60 s con «muestra a
    N s»; en modo por parciales, la media del parcial.
- Pista con tiempo: tabla `run_tracks` (≤ 1 punto cada 2 s, con altitud) sacada del GPX
  completo de Blob; el build rellena las que falten y, si no, se hace al abrir la carrera.

## Comparación con el mismo tramo

Las tarjetas de Volumen (semana, mes, año) comparan lo transcurrido del periodo con el
**mismo tramo del anterior** (`comparePeriodToDate`): lunes→hoy frente a lunes→mismo día de
la semana pasada; 1→hoy del mes o del año frente a 1→mismo día del anterior (si el anterior
es más corto, p. ej. 31 mar frente a febrero, se compara entero y se avisa). El texto muestra
los dos rangos («1–18 oct»). Sin carreras en lesión. Ejes de ritmo: marcas cada 15/30 s y
rango ajustado a los datos (`src/lib/analysis/axis.ts`). Vista Año: una columna por año
desde el primero hasta el actual y un punto de ritmo por año con datos, alineados.

## Periodos de lesión

En **Perfil → Periodos de lesión**: inicio, fin opcional (sin fin = abierto hasta hoy) y
nota corta; añadir, editar y borrar (con segundo toque para confirmar). Tabla `injuries`;
`runs.in_injury` se recalcula con fechas de Madrid al guardar o borrar
(`src/lib/analysis/injuries-db.ts`), y además se vuelven a clasificar los tipos.
- Las carreras dentro **se guardan, se ven y sus km cuentan** en totales, Volumen y
  calendario.
- **No cuentan** en: ritmo medio (Inicio 28 días, Volumen, ritmo a igual FC, tendencia de
  la evolución del ritmo), sugerencias de objetivos, comparación con el periodo anterior,
  tabla de comparación de años y base del clasificador de tipos.
- **Sí cuentan** en los récords.
- Gráficos: banda gris suave «Lesión» (Volumen por columnas, evolución del ritmo, km
  acumulados del año, evolución de récords); en el calendario, raya inferior gris. En la
  evolución del ritmo, los puntos en lesión se ven apagados. En Volumen las bandas van en
  un eje numérico oculto (cubren columnas enteras) y al fondo: no tapan barras, media
  móvil ni objetivo; si hay banda en las 3 últimas columnas, la etiqueta del objetivo pasa
  a la izquierda. En el calendario, contorno gris fuera de la casilla (no tapa su color).
- Ejes de tiempo (evolución del ritmo y de récords): marcas regulares el día 1 de cada N
  meses (o cada N días en rangos cortos), como mucho 5, en español
  (`src/lib/analysis/time-ticks.ts`, con pruebas). Cálculos puros en
  `src/lib/analysis/injuries.ts` (con pruebas).

## Récords personales

`/analisis/records` (enlace desde Análisis): 1 km, 1 milla, 5 km, 10 km, media y maratón
con tiempo, ritmo, fecha y enlace a la carrera; «Sin datos suficientes» si ninguna carrera
tiene un tramo continuo de esa distancia. Tocar una distancia abre su evolución: cada
carrera es un punto (su mejor esfuerzo), la escalera es el récord vigente, % de mejora
del primer récord al actual y récords de los últimos 12 meses en lima.

**Mejor esfuerzo** (`src/lib/analysis/best-efforts.ts`): distancia acumulada del reloj
frente al tiempo, ventana deslizante con interpolación lineal. Las **pausas parten la
carrera** en tramos continuos y un esfuerzo nunca las cruza: hueco > 15 s cuya muestra
cubre < 1 m/s (un hueco largo con distancia de carrera es una muestra continua, no una
pausa). Se descartan esfuerzos más rápidos de 2:30 /km. Resultado en `run_efforts`
(se recalcula al reprocesar o al cambiar la versión de reglas).

**Muestras anómalas** (reglas versión 8): de cada muestra solo se guarda el final de su
intervalo. El reloj registra muestras completas de ~300 s y, entre medias, muestras finas de
2–3 s que se solapan con ellas. Una muestra larga que llega detrás de muestras finas tiene un
hueco (desde la anterior) más corto que su intervalo real, así que su velocidad implícita sale
inflada y fabrica récords (4‑jul‑2026: 886 m en 105 s = 2:00 /km, daba un «1 km en 2:32»; y
otras tres: 946 m en 141 s, 801 m en 179 s y 929 m en 236 s = 3,94 m/s, que ningún umbral de
velocidad razonable separa de las muestras legítimas de 2021 a 4,0 m/s). Se descarta una
muestra, y se parte el tramo antes y después, cuando:
- el hueco es ≥ 10 s y la velocidad > 7 m/s, o
- es «larga con hueco corto»: ≥ 300 m, hueco de 10 a 270 s y detrás de una muestra que
  tampoco era completa (hueco < 270 s). Una última muestra más corta detrás de una completa
  es legítima. En los datos reales: 38 muestras en 26 carreras, todas de ~800–1300 m.
Con hueco < 10 s no se juzga (muestras de 2–3 s con 14–17 m son redondeo y salen por cientos).
Ningún esfuerzo cruza una muestra descartada; el tramo siguiente empieza donde ella termina. Si
el mejor esfuerzo de un tramo baja de 2:30 /km se ignora ese tramo, no toda la distancia.
Límite conocido: una muestra casi completa (hueco 270–305 s) con prisa de más sigue
valiendo; su error es < 10 %.

Datos reales: 1202 huecos > 15 s; 164 son pausas (57 carreras, mediana 58 s); 1038 son
muestras largas continuas. Las 15 carreras válidas sin muestras de distancia tienen su
distancia exacta del total de Apple, pero ninguna puede dar récords: 5 son de 2016–2017
sin muestras ni GPS; 3 tienen GPS útil pero < 1 km; 1 GPX tiene 4 puntos; el resto, < 2 km
sin GPS.

## Tema día / noche

- Selector en Perfil → Apariencia: **Sistema** (por defecto, sigue al iPhone), **Día** o
  **Noche**. Se guarda en este dispositivo (`localStorage` `stride-theme`) y un script en
  `<head>` lo aplica antes de pintar (sin parpadeo). Día/Noche ponen `data-theme` en
  `<html>`; Sistema lo quita y manda `prefers-color-scheme`.
- Todos los colores son variables CSS en `globals.css` (bloque noche en `:root`, bloque día
  repetido para el sistema claro y para `data-theme="light"`). Nada de colores fijos en
  componentes: superficies (`ov-1`, `ov-2`, `inset`, `map`, `bar`, `glass`), texto
  (`fg`, `fg-2`, `fg-3`, `lime-text`), gráficas (`chart-*`), ruta (`route`), zonas
  (`z1…z5`), carga (`load-*`) y tipos (`t-*`).
- Día: fondo `#F3F3EE`, tarjetas blancas, lima `#C8F23A` como relleno de acento (botón y
  chip activos con texto casi negro); para texto y líneas sobre blanco se usa un lima
  oscuro (`#4A6B00` texto, `#5A8500` líneas, `#4F7A00` ruta). Tipos en día: paleta
  validada sobre blanco (todos ≥ 3:1). Mapa base: OpenFreeMap `positron` (día) / `dark`.
- ECharts usa `var(--…)` en las opciones; `EChart` las resuelve y vuelve a pintar al
  cambiar el tema. El mapa se recrea con el estilo del tema.
- `tests/theme.test.ts` comprueba en los dos temas: texto ≥ 4,5:1 (fg, fg-2, fg-3,
  lima sobre tarjeta y fondo, tinta sobre lima, peligro) y gráficos ≥ 3:1 (línea, ruta,
  zonas, carga, 8 tipos).

## Estilo común de los gráficos

`src/components/charts/theme.ts` (con pruebas) es la única fuente del estilo de todos los
gráficos: colores del tema (`var(--x)` y `alpha(var(--x),a)`, que resuelve EChart.tsx en día
y noche), líneas de 2 px suaves y redondeadas con degradado transparente y punto con brillo
solo bajo el cursor, barras con esquinas superiores redondeadas, degradado sutil y espacio
(la actual en acento con brillo), ejes sin líneas con etiquetas de 10 px tenues y sin
solaparse, rejilla muy tenue, objetivos y medias en línea fina discontinua con la etiqueta a
un lado, tooltip único (compacto, desenfocado, siempre al lado del dedo) y animación de
entrada suave. EChart actualiza con ids estables (`withIds`): cambiar de filtro o tocar anima
la transición sin repetir la entrada; las páginas ya no remontan los gráficos al filtrar.
`ChartEmpty`: estado vacío o con pocos datos (dibujo discreto y mensaje corto). Lo usan
Inicio (km por mes, VO₂), Análisis (Volumen semana/mes/año/por tipo, ritmo por periodo,
evolución del ritmo, eficiencia, año frente a año, km por año y tipo, VO₂), Récords, barras de
series y el detalle de carrera.

## Carga y forma

Lógica pura en `src/lib/analysis/fitness.ts` (con pruebas); vista en Análisis (`#forma`) e Inicio.
- **Carga de cada carrera** (`runLoad`, `hr-zones.ts`): *medida* si las muestras de pulso cubren
  ≥ 80 % de la duración (minutos por zona × 1…5); *estimada (≈)* con el pulso medio si cubren
  menos (toda la duración en su zona; sin pulso medio, la media de ≥ 5 muestras); *sin dato* si
  no hay pulso (no cuenta y se dice). Antes de jul‑2026 el reloj guardaba muy pocas muestras
  (cargas de 1–10), por eso la regla. Se aplica en `reclassifyAll` (Reprocesar, guardar zonas y
  al desplegar: reglas versión 10) y al guardar una carrera manual. Columna `load_estimated`.
- **Carga diaria**: suma por día (Madrid); sin correr = 0. **Aguda**: media de 7 días.
  **Crónica**: media exponencial de 28 días (α = 1 − e^(−1/28)), desde el primer día con
  historial. **Forma** = crónica − aguda. **Ratio** = aguda/crónica (sin ratio con crónica < 5).
  Estados: < 0,8 Descansado · 0,8–1,3 En forma · 1,3–1,5 Cargado · > 1,5 Sobrecargado.
  Las lesiones cuentan como carga; con lesión abierta se avisa.
- **≈**: una cifra lleva ≈ si en sus 28 días hay cargas estimadas o sin dato, o si hay menos de
  28 días de historial (en calentamiento). Se muestran cuántas carreras están medidas, estimadas
  y sin dato.
- **Carga semanal**: lunes a domingo frente a la media de las 8 anteriores; aviso si sube > 30 %
  sobre la anterior (la semana en curso, frente a los mismos días de la anterior) **y** supera la
  media de las 8 semanas previas (con ~2 carreras/semana, el 30 % solo saltaba 15 veces al año).
- **Hoy**: tras las reglas de siempre, el ratio solo endurece: ≥ 1,3 como mucho rodaje suave
  (también > 1,5, porque con ~2 carreras/semana una sola semana buena lo dispara); descanso por
  carga solo con ratio > 1,5 y dos días seguidos corriendo (la lesión abierta ya manda descanso).
  Calidad solo con < 1,3. Sin 28 días de historial no se usa y se dice. Análisis muestra el
  estado tal cual.
- `ensureClassified` comparte una sola comprobación entre consultas simultáneas (antes dos
  recálculos a la vez chocaban en `run_efforts`) y no repite la comprobación en 5 min.

## Botones y toques (una sola definición)

Todo el comportamiento táctil vive en `globals.css` (bloque «Interacción») y en cuatro piezas
de `src/components/ui/`; ninguna pantalla define su propio pulsado (una prueba lo vigila).
- Pulsado inmediato: escala 0,97 + brillo (más claro de noche, algo más oscuro de día),
  120 ms, `touch-action: manipulation`, sin resaltado gris de iOS. Los enlaces dentro de un
  texto no se encogen.
- Foco visible solo con teclado (contorno + halo lima); desactivado al 45 % y sin color;
  `aria-busy` con cursor de espera. «Reducir movimiento» quita escalas y animaciones.
- `Segmented`: selector con indicador lima que se desliza a la opción elegida (cápsula o
  fila de chips desplazable). Lo usan Semana/Mes/Año, 12/26 sem., Total/Por tipo, 12 meses/Todo,
  franjas de pulso, rangos y tipos de ritmo, Km/Carga, Rodaje/Todas, filtros de Actividad,
  Distancia/Tiempo del detalle y el tema. Con `href` navega sin saltar arriba.
- `Switch`: interruptor con el botón que se desliza y se estira al pulsar (GAP del detalle).
- `SubmitButton`: durante la acción se desactiva y muestra un spinner y el texto de espera
  (solo gira el botón pulsado si hay varios); al terminar, ✓ o ✕ durante 1,6 s.
- `Toaster` + `useActionToast`: aviso breve arriba (éxito 2,6 s, error 6 s, máx. 3, el mismo
  no se apila). Cuando la acción redirige (guardar o borrar una carrera) el aviso viaja como
  `?aviso=` y `FlashToast` lo muestra y limpia la URL. Lógica pura en `lib/ui/feedback.ts`.
- Acciones largas cubiertas: Guardar objetivos, Guardar y recalcular (zonas y tipos),
  periodos de lesión (guardar y borrar), carrera manual (Ver resumen, Guardar, Borrar), tipo
  de sesión, Reprocesar/Continuar del importador (spinner y aviso al terminar o fallar), Entrar.
- Objetivos de toque ≥ 44 px (selectores, casillas, filas de parciales y series, enlaces de
  las tarjetas de Inicio). Excepción a propósito: las celdas del calendario de constancia
  (16 px, solo informativas).
- Transición entre pantallas con `ViewTransition` de React (fundido de 180 ms); la barra
  inferior queda fija (`view-transition-name: tabbar`).

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
`app_settings`, `imports` (+ `lease_until`), `shoes`, `runs` (+ `in_injury`), `run_routes`, `run_splits`
(+ `basis`), `run_series` (hr | power | speed | distance), `import_samples` (temporal
durante la importación), `vo2max_readings`, `injuries`, `run_efforts` (mejor esfuerzo por
carrera y distancia).

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

## Tipos de sesión

Tipos: Rodaje, Tirada larga, Series, Tempo, Recuperación, Competición, Trail, Cinta. Cada
uno con icono y color (paleta categórica validada sobre la superficie #151712, orden fijo:
azul, naranja, aqua, amarillo, magenta, verde, violeta, rojo); el tipo **seleccionado** va
en lima. El color nunca va solo: siempre icono + nombre.

- Columnas en `runs`: `session_type_auto`, `session_type_reason` (por qué) y
  `session_type_manual`. Tipo efectivo = manual si existe; si no, automático.
- **Reglas automáticas** (`src/lib/analysis/session-type.ts`, la primera que se cumple):
  1. Series: el reloj marcó intervalos de verdad: **5 o más rutas de paso distintas**
     (`WOIntervalStepKeyPath`) **y alguna con repetición** (2.º o 3.º componente ≠ 0,
     p. ej. `1.0.1`, `1.1.0`). El Apple Watch pone `0.0.0` en rodajes normales, así que ese
     valor solo no cuenta. El importador guarda todas las rutas distintas en
     `raw.intervalSteps` (hace falta «Reprocesar» el zip para tenerlas en carreras viejas).
  2. Cinta: indoor.
  3. Tirada larga: ≥ 13 km (configurable).
  4. Trail: desnivel positivo ≥ 25 m por km (configurable).
  5. Con pulso, por la zona del pulso medio: Z1 → Recuperación; Z2 → Rodaje; Z3 o más →
     Tempo si el ritmo es ≥ 4 % más rápido que tu media (mediana de los 12 meses previos,
     carreras comparables), si no Rodaje. Sin pulso: ≥ 7 % más rápido → Tempo, ≥ 10 % más
     lento → Recuperación, si no Rodaje.
  Competición nunca se adivina.
- Se recalcula al terminar cada importación, con «Guardar y recalcular» en Perfil y, si
  las reglas cambian de versión (`CLASSIFIER_VERSION`) o hay carreras válidas sin tipo, al
  abrir cualquier pantalla. El manual nunca se toca.

## Zonas de FC y carga

- Ajustes en `app_settings` (`hr_zones`): las zonas del Apple Watch del usuario — reposo 47,
  FC máx. 187, reserva cardíaca; Z1 < 131, Z2 131–144, Z3 145–158, Z4 159–172, Z5 ≥ 173
  (= 60/70/80/90 % de la reserva; «Calcular límites» las reproduce). Editables en Perfil.
- Tiempo en zona por carrera (`runs.hr_zone_seconds`): cada muestra de FC cuenta hasta la
  siguiente, como máximo 30 s (no rellena pausas); por debajo de Z1 cuenta como Z1.
- Carga (`runs.training_load`): minutos en zona × 1…5 (TRIMP de Edwards). Rayo verde
  < 120, naranja 120–249, rojo ≥ 250. Sin muestras de FC no hay carga («—» / sin insignia).
- Se ve en Actividad (insignia) y en el detalle (insignia + tarjeta de zonas).
- **Guardar y recalcular** (Perfil): guarda zonas y umbrales y vuelve a calcular zonas,
  carga y tipos automáticos de todas las carreras.
- **Cambio manual**: en el detalle se toca la etiqueta del tipo y se abre una hoja con los
  8 tipos; elegir uno lo guarda como manual al momento. En la hoja, «Volver a automático»
  borra el manual. Las carreras con tipo manual llevan un lápiz pequeño en su etiqueta.
- **El manual manda siempre**: ni Reprocesar (el upsert no toca `session_type_manual`; al
  unir sesiones se conserva) ni «Guardar y recalcular» lo cambian. Cubierto por pruebas.
- **Actividad**: filtros por tipo (`?tipo=`) con recuento y etiqueta del tipo en cada fila.
- **Inicio**: km por tipo de los últimos 12 meses. **Análisis**: km por tipo (12 meses o
  todo) y km por año apilados por tipo, con leyenda.

## Riesgos y pendientes

- La 1.ª importación real dirá si el formato del export coincide con lo esperado
  (nombres localizados, `FileReference`, unidades). La pantalla muestra el error exacto
  si algo falla y se puede reanudar.
- Neon Free: 0,5 GB de almacenamiento; las series ocupan poco (estimado < 50 MB).
- Cambiar contraseña desde Perfil.
- Zona horaria: se guarda en UTC; se muestra en Europe/Madrid.

## Distancia sin duplicar y sesiones partidas

- **Problema (2026‑11‑17):** en sesiones con bloques (series), la «primera aparición» de
  `DistanceWalkingRunning` era solo el calentamiento (1,0–3,2 km de sesiones de 6–13 km).
- **Ahora** (`src/lib/import/distance.ts`) se guardan **todas** las apariciones con su
  nivel (bloque `<WorkoutActivity>` o entrenamiento) en `raw.distanceStats`, y se elige:
  1. la de nivel entrenamiento que cubre ≥ 95 % de la sesión, sola;
  2. si no, la suma de las de bloque, solo si no se solapan y cubren ≥ 90 %;
  3. si no, la suma de las muestras de distancia del reloj (`raw.distanceFrom = "samples"`).
  Nunca se suman a la vez el total del entrenamiento y los bloques. Las carreras de un solo
  bloque (17‑oct) no cambian.
- **Sesiones partidas:** entrenamientos de la misma fuente separados por < 2 min se unen en
  una sola sesión (`src/lib/import/consolidate.ts`): duración y distancia sumadas, medias
  ponderadas por tiempo, series de FC/potencia/distancia unidas (zonas y carga de las dos
  partes), parciales recalculados; `raw.mergedFrom` guarda las claves originales. Al
  reimportar se vuelve a unir sin duplicar.

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

- 2026‑11‑18 — Carga y forma: carga por carrera medida/estimada (≈)/sin dato, aguda, crónica,
  forma y ratio con estados, carga semanal con aviso de subida, tarjeta en Inicio y «Hoy» con
  el ratio. Reglas versión 10.
- 2026‑11‑18 — Botones y toques en toda la app: pulsado inmediato y foco visible definidos una
  vez, selectores con indicador deslizante, interruptor animado, botones con spinner y ✓/✕,
  avisos breves (también tras redirigir), objetivos de 44 px y transición suave entre pantallas.
- 2026‑11‑18 — Ritmo sin huecos: el GPS rellena los tramos sin distancia del reloj; sin GPS,
  el ritmo del parcial o la muestra cercana en escalón. Solo las pausas reales quedan como
  punteado fino. Parciales sin datos fiables con ritmo del GPS o estimado (≈).
- 2026‑11‑18 — Inicio rediseñado: Hoy (recomendación provisional), semana día a día, mes con
  el mismo tramo, última carrera, y abajo 28 días, tipos, récords, eficiencia y VO₂; botón «+»
  y banda de modo lesión.
- 2026‑11‑18 — Estilo premium común en todos los gráficos (`theme.ts`), sin repetir la
  animación al filtrar. Detalle del 4‑jul: franja fija, pulso por parcial desde 60 ppm,
  banda «sin datos» y eje de km con el GPS cuando las muestras se quedan cortas.
- 2026‑11‑18 — Gráficos del detalle: pulso por zonas (barras por parcial si hay pocas
  muestras), ritmo sin picos y con eje de percentiles, altitud sin cortes y por pendiente,
  cursor con punto brillante y tarjeta flotante. 60 fps con la CPU 4× más lenta.
- 2026‑11‑18 — Carreras añadidas a mano (con .gpx/.tcx/.fit opcional), edición y borrado,
  sustitución por el zip conservando tipo, nota y calzado. Migración 0008.
- 2026‑11‑18 — Series (repeticiones y recuperaciones desde los pasos del reloj; hace falta
  Reprocesar para las carreras ya importadas), desacople solo con ritmo estable y eficiencia
  aeróbica en Z2 con su tendencia en Análisis. Reglas versión 9, migración 0007.
- 2026‑11‑18 — Detalle de carrera: mapa y gráficos sincronizados (ritmo suavizado con GAP
  opcional, pulso con zonas, altitud, potencia), tarjeta del instante, parciales que se
  resaltan en mapa y gráficos. Tabla `run_tracks` (migración 0006).
- 2026‑11‑17 — Récords: las muestras con velocidad implícita imposible (muestras largas con hueco corto o > 7 m/s) se descartan y parten el tramo; reglas versión 8; el build recalcula tras migrar
  (`scripts/recompute.mts`, no rompe el despliegue si falla). Análisis: tarjetas con el mismo
  tramo del periodo anterior y ejes de ritmo regulares.
- 2026‑11‑17 — Revisión visual: bandas «Lesión» al fondo y por columnas enteras, objetivo
  sin tapar, contorno en el calendario, marcas de fecha regulares en español, etiquetas de
  semana sin solaparse. 139 pruebas.
- 2026‑11‑17 — Periodos de lesión (Perfil) excluidos de ritmos medios, sugerencias,
  comparaciones y clasificador, con bandas «Lesión» en los gráficos. Récords personales
  con mejor esfuerzo por tramos continuos y su evolución. Arreglo: el componente MarkArea
  de ECharts no estaba registrado (tampoco se veía la columna seleccionada en «Por tipo»);
  ejes de tiempo en español. Reglas versión 5. 135 pruebas.
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
- 2026‑11‑17 — Análisis: km por tipo apilados y media móvil de 4 semanas, evolución del
  ritmo, calendario de constancia y comparación de años. 121 pruebas.
- 2026‑11‑17 — Objetivos de km (semana/mes/año) y volumen por periodo con detalle,
  objetivo, ritmo medio y comparación. 113 pruebas.
- 2026‑11‑17 — Zonas reales del Apple Watch (47/187). Reclasificación: 7 carreras cambian
  (6 Tempo → Rodaje con FC 141–144, ahora Z2; 1 Rodaje → Recuperación con 129). 16 Series
  en 12 meses; el 10‑dic‑2025 (13 pasos `N.0.0`, sin repeticiones) no cuenta como Series.
- 2026‑11‑17 — Tipo manual con hoja de selección y marca de lápiz; pruebas de que
  Reprocesar y recalcular no lo pisan y de «Volver a automático». 105 pruebas.
- 2026‑11‑17 — Distancia sin duplicar (todas las apariciones de DistanceWalkingRunning;
  respaldo con muestras del reloj) y unión de entrenamientos seguidos (< 2 min). 104 pruebas.
- 2026‑11‑17 — Tema día/noche (Sistema, Día, Noche) con contraste comprobado; 91 pruebas.
- 2026‑11‑17 — Series por rutas de paso con repetición; tirada larga desde 13 km;
  «Reprocesar» zip. Zonas de FC editables, tiempo en zona, carga y tipos por zona;
  «Guardar y recalcular». 35 pruebas.
- 2026‑11‑17 — Tipos de sesión: clasificación automática por reglas, tipo manual aparte
  con un toque, filtros en Actividad y km por tipo en Inicio y Análisis. 32 pruebas.
- 2026‑11‑17 — Arreglo de la subida (ver Incidencias): subida por partes reanudable,
  «Continuar la subida», MB subidos/que faltan, lista de zips ya subidos, creación de la
  importación sin callbacks, aviso con «Reintentar/Continuar» tras 60 s sin cambios.
  24 pruebas (5 nuevas de subida y 1 de creación desde un zip existente) y prueba en
  navegador con Blob simulado: corte, recarga, reanudación enviando solo la parte que
  faltaba.
