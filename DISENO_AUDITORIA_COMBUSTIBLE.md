# DISEÑO — Auditoría de Combustible que se pueda creer

> Encargo de Máximo (2026-07-24): **"que las auditorías sean reales e importantes"**.
> Hoy se demostró que la mayoría de las alertas de "merma" eran falsos positivos, y ya salieron
> por WhatsApp con nombre y apellido de choferes reales. Este documento deja el diseño de cómo
> se hace bien, verificado contra la base de datos (proyecto `hrkjddehqnzcqwlkklqm`).
> El aviso automático de sustracción está APAGADO (`AVISAR_SUSTRACCION=false` en
> `supabase/functions/auditar-combustible/index.ts`) hasta cumplir el camino del punto 7.
>
> Este módulo se VENDE (FlotaMax): nada de lo que sigue depende del nombre de la empresa;
> todo se decide por los datos que haya (modo cubicación / modo surtidas), como ya hace el código.

---

## 1. Verificación propia de los 8 defectos (y 6 hallazgos nuevos)

Se reprodujo la regla R1 con SQL directo sobre `combustible_mediciones`, `gasoil` y `checklist`
(24/07/2026). Resultado por punto:

**1.1 — R1 no comprueba que el camión estuviera estacionado. CONFIRMADO, y es peor de lo dicho.**
La regla compara la salida de hoy contra la última llegada aunque haya días de por medio, y nunca
mira el odómetro. Reproduciendo el cálculo sobre TODO julio (sin limitarse a la ventana de 15 días
de la UI) salen **26 casos de "merma"** con las dos lecturas presentes y sin despacho entre medio.
De esos, **12 tienen kilómetros rodados comprobables entre las dos mediciones** (odómetro del
checklist): B009 13/07 (75 km), B006 13/07 (158), B003 13/07 (174), B005 14/07 (190), B006 15/07
(208), B002 16/07 (95), B008 16/07 (66), B008 17/07 (56), B009 18/07 (100), B011 18/07 (119),
B006 18/07 (54), B008 24/07 (157). El caso testigo cierra exacto: JAC-B009 13/07 "merma" de
39,1 L; rodó 75 km sin jornada; a 1,9 km/L son 39,5 L. **No era merma: era el consumo de un viaje
que nadie registró.** Eso es un hallazgo valioso — pero es OTRA anomalía, no robo.

**1.2 — La cubicación del tanque JAC es una recta. CONFIRMADO.**
`combustible_tanques_config` id `tanque-jac`: 46 puntos exactamente iguales a 600 ÷ 46 = 13,0435 L
por cm (1→13,04 … 46→600). No es una cubicación: es una regla de tres. Los dos tanques del galpón
sí tienen curva real (0, 3.42, 9.65, 17.68, 27.15… hasta 2.300,02 L en 109 cm). JAC-B010 operó en
julio entre 4 y 37 cm, con muchos días en la zona baja (4, 8, 10, 11.5 cm) — justo donde cualquier
tanque real se aparta más de la recta. **Ni siquiera la capacidad de 600 L está verificada** (ver
punto 5).

**1.3 — `gasoil` muerto desde el 07/07. CONFIRMADO, y se encontró la causa.**
Última fecha operativa `f='2026-07-07'` (316 filas totales, 25 con esa fecha). No se rompió el
código: `guardarGasoil()` (app.js ~6781) funciona. Lo que pasó es de PROCESO: los despachos los
tipeaba a mano el usuario **`rrhh1`** desde la oficina, **en lote y días después** (la tabla
`auditoria` muestra la sesión del 08/07 19:21–19:31: los despachos del 07/07 cargados uno cada
~10 segundos), y **después del 08/07 nadie volvió a cargar**. Además los montos delatan que no son
eventos medidos sino **cuotas administrativas**: 80 L + 120 L parejos para toda la flota, todos con
`src='Estacion'`. Y la última COMPRA registrada es del **26/03** (Tumaca, 2.000 L). Consecuencia en
plata: julio venía moviendo ~2.000–2.400 L/semana de despachos; a $0,812/L (`configuracion.tanque_costo`)
son **~$1.600–1.950 por semana de costo de combustible que desde el 08/07 no entra a la Utilidad
Real** (~$4.000–5.000 acumulados al 24/07). El módulo Rentabilidad x Camión y el Financiero leen
`gasoil`: están ciegos desde esa fecha.

**1.4 — El combustible del camión vive en dos tablas. CONFIRMADO.**
`surtidas` existe con **una sola fila**: JAC-B004, 22/07, 200 L, `tanque='estacion'`, con foto y
GPS, `costo_usd=0`, `pago_estado='pendiente'`. La escribe la PWA del chofer. La auditoría
(`acCargar`, app.js ~1198, y la edge function línea 50) **solo lee `gasoil`**. O sea: la única
surtida con evidencia real (foto+GPS) es invisible para la auditoría, y encima con costo cero
tampoco entra a la Utilidad Real. Viola la norma de fuente única de un dato.

**1.5 — Tolerancia más fina que el instrumento. CONFIRMADO.**
De 729 mediciones de camión, **720 son centímetros enteros** (9 con decimal). La resolución real de
lectura es 1 cm, no 0,5. Solo el redondeo de DOS lecturas ya mete ±1 cm ≈ ±13 L con la recta
actual; la tolerancia `AC_TOL_CAMION=15` L dispara alerta roja con una diferencia de 2 cm, que es
indistinguible del ruido (regla + camión no nivelado + gasoil que se mueve). Ver fórmula en punto 4.

**1.6 — Duplicados con valores distintos rompen el emparejado. CONFIRMADO.**
JAC-B006 17/07: llegadas 20 cm (20:09:50), 20 cm (20:09:55, idéntica → el dedupe la mata) y
**16 cm** (01:55 UTC del 18 = 21:55 hora VE — una corrección tardía que el dedupe NO mata porque
la altura es distinta). JAC-B009 17/07: salidas 26, 26, 26 y **27** cm. `_acDedupe` (app.js ~1180)
solo colapsa filas idénticas por (vehiculo, fecha, momento, altura); la lectura distinta queda viva,
`_acArmarJornadas` la empareja mal y esa "llegada suelta" se vuelve la referencia del día siguiente.
Causa de fondo: `chofer.html` hace `insert` liso a `combustible_mediciones` (línea ~2185), sin
upsert ni idempotencia — cada toque del botón y cada corrección es una fila nueva.

**1.7 — Alturas imposibles que igual entran al cálculo. CONFIRMADO.**
JAC-B002 18/07 salida: `altura_cm=264` en un tanque de `altura_max_cm=46`, guardada con
`litros_calculados=600` (el espejo del chofer topea al máximo). R8 la marca como "fuera de rango"
pero la jornada igual entra al cuadre con 600 L. Seguramente era 26,4 o un dedazo de 26.

**1.8 — `km_entrada=0` genera km negativos. CONFIRMADO, con un matiz importante.**
Hay 13 checklists de julio con `km_entrada=0` (B003 03/07, B008 10/07, B003 y B008 11/07, B005 y
B006 13/07, B011 17/07, B006 20/07, B012 22/07, B008 23/07…). Pero OJO: **hoy 24/07 TODOS los
camiones en la calle tienen `km_entrada=0`** — el cero es el estado "checklist sin cerrar", no un
error de tipeo. La regla R10 ("kilometraje al revés") no distingue 0 de "todavía no volvió": si se
audita el día en curso, dispara para toda la flota. El 0 hay que tratarlo como null SIEMPRE.

### Hallazgos nuevos (no estaban en la lista)

- **N1 — Combustible que entra sin registro alguno:** JAC-B008 18/07 salió con 26 cm y llegó con
  46 cm (lleno): **+260 L entraron ese día y no hay ni despacho ni surtida**. Eso es plata que se
  pagó en algún lado y no está en ningún libro. Hoy la auditoría lo reporta como "R5 apareció
  combustible" (anécdota); es en realidad un hueco administrativo grave (ver regla R13).
- **N2 — El galpón nunca se midió:** cero filas en `combustible_mediciones` con tanque de galpón,
  en toda la historia. El "cuadre del tanque del galpón" jamás tuvo datos; `configuracion.tanque_nivel`
  está congelado en 1.340 L. Con compras muertas desde marzo, hay que decidir si el galpón sigue
  operativo o si todo se surte en estación (los datos dicen lo segundo).
- **N3 — Copia congelada de la cubicación en `chofer.html`:** `CL_JAC_CUB` (línea ~2166) es un
  espejo hardcodeado de la tabla de `tanque-jac`. Si se corrige la tabla en la BD, el chofer sigue
  guardando `litros_calculados` con la recta vieja. Violación directa de la norma de fuente única.
- **N4 — Odómetros con dedazos groseros sin validación:** B007 30/06 `km_entrada=10` (venía de
  ~10.000), B010 29/06 `km_entrada=1050`. Un dígito comido genera "km del día" de miles de km y
  contamina cualquier regla que use kilómetros.
- **N5 — La "salida" a veces se carga a la tarde:** B009 17/07, medición de salida creada 20:17 UTC
  (16:17 VE), un minuto antes que la llegada. El chofer llenó todo junto al final del día, de
  memoria. `created_at` vs `momento` lo delata y hoy nadie lo mira.
- **N6 — Lo que sobrevive al filtro también existe:** aplicando la precondición de odómetro que R1
  no tiene, quedan en julio casos con **odómetro idéntico** entre llegada y salida y faltantes
  grandes: B008 09/07 (−117 L, km 11.387=11.387), B008 19/07 (−117 L la noche después de llegar
  lleno, km 13.002=13.002), B010 22/07 (−98 L), B006 04/07 (−65 L), B002 03/07 (−52 L). Con la
  recta actual esos litros tienen ruido, pero 117 L no son 2 cm de regla. **La auditoría bien hecha
  no va a quedar muda: va a señalar menos veces, y va a tener razón.**

Del cron: solo salieron 3 tandas de WhatsApp (`alertas_log` claves `comb_jefes_2026-07-21/22/23`).
El daño de las acusaciones fue reciente y acotado. El cron es `cron.job` id 37
(`auditar-combustible-diario`, 11:00 UTC = 7:00 Caracas).

---

## 2. El principio: cuándo una máquina puede insinuar sustracción

Una auditoría automática compara números. Las personas se acusan con evidencia, no con números
solos. La distinción que TODO el módulo tiene que respetar:

| Categoría | Qué es | Ejemplo real | Qué se hace |
|---|---|---|---|
| **Dato faltante** | Falta una medición, un km, una surtida | B005 13/07 sin `km_salida` | Se pide el dato a quien debía cargarlo. Jamás insinúa nada. |
| **Dato contradictorio** | Dos registros que no pueden ser ciertos a la vez | B002 18/07: 264 cm en un tanque de 46; dos llegadas distintas el mismo día | Se corrige el dato; el día queda FUERA del cuadre. Si una persona acumula contradicciones, eso se conversa como calidad de datos, no como robo. |
| **Pérdida física comprobada** | Balance negativo con todas las precondiciones cumplidas y fuera de 2× la tolerancia | B008 19/07: −117 L con odómetro idéntico | Se investiga. El mensaje dice el HECHO (faltan X litros de la unidad Y entre tal hora y tal hora), no el culpable. |

Reglas de comunicación (quién puede recibir qué):

1. **Al chofer**, solo errores de carga SUYOS y corregibles ("falta la medición de llegada", "el km
   quedó en cero"). Tono de pedido, nunca de reclamo. Esto ya lo hace bien la edge function.
2. **A jefes (mecánica/operativo) y socios**, hechos por unidad con montos. Sin adjetivos.
3. **Un nombre propio asociado a una sospecha de sustracción NO sale nunca de forma automática.**
   Ni siquiera cuando el sistema esté calibrado. El automático dice "la unidad B008 perdió 117 L
   estacionada la noche del 18 al 19"; la pregunta de quién tuvo acceso la hace una persona.
   Razón de fondo: de noche el camión está en el patio de la empresa — **el custodio nocturno no es
   el chofer**, y era al chofer a quien el sistema le colgaba la merma (`hoy.chofer||ant.chofer`).
4. Un dato faltante JAMÁS se usa como evidencia de sustracción. "No hay despacho que lo explique"
   era mentira estructural: no había despachos porque nadie los cargaba desde el 08/07.

---

## 3. La cadena de custodia del litro

Hoy el litro se pierde de vista porque cada tramo vive en un lugar distinto y dos de ellos están
muertos. El balance correcto, tramo por tramo, con UNA fuente por dato:

```
COMPRA (proveedor → galpón)          gasoil tipo_operacion='compra' + CxP automática
  └─ medición de regla del galpón antes y después de recibir (hoy: nunca se hizo)

DESPACHO (galpón → camión)           HOY: gasoil tipeado por oficina días después (muerto 08/07)
                                     DISEÑO: una fila en `surtidas` con origen='galpon',
                                     registrada EN EL MOMENTO por quien despacha (PWA, foto del
                                     contador o de la regla, GPS), no de memoria en la oficina.

SURTIDA (estación → camión)          `surtidas` con origen='estacion' (ya existe: foto+GPS+costo).

MEDICIÓN (cuánto hay)                `combustible_mediciones` (chofer, salida y llegada, en cm).

RECORRIDO (en qué se gastó)          `checklist.km_salida/km_entrada` (0 = sin dato, siempre).

COSTO ($/L)                          `configuracion.tanque_costo` (promedio real de compra).
```

**Decisión de fuente única:** todo litro que ENTRA a un camión = una fila en **`surtidas`**, venga
del galpón o de la estación (columna `tanque`/`origen` ya distingue). `gasoil` queda solo para
compras al galpón y como histórico congelado de despachos hasta el 2026-07-07 — la auditoría lee
`gasoil` únicamente para fechas anteriores a ese corte, con el corte escrito en una constante con
nombre que lo delate (`CORTE_GASOIL_DESPACHOS='2026-07-08'`), como manda la norma de freeze.

**El cuadre por unidad** (el corazón de la auditoría):

```
litros al inicio (cubicación de la 1ª medición del período)
+ Σ surtidas del período
− litros al final (cubicación de la última medición)
= consumo medido

consumo esperado = km rodados del período ÷ rendimiento de referencia (1,9 km/L para JAC 1131,
                   `configuracion.aud_comb_rend_ref`, por MODELO)

residual = consumo medido − consumo esperado    → se compara contra la tolerancia del punto 4
```

**Dónde se cierra:** cuadre **semanal por unidad** (lunes–sábado, la semana operativa de Betangar)
y **mensual por flota**. El cuadre diario queda como vistazo, no como veredicto: con lecturas de
±1 cm, un solo día casi nunca tiene precisión para afirmar nada (ver punto 4); una semana acumula
6 jornadas de km contra 2–3 surtidas y el ruido se diluye. El cierre mensual además alimenta el
costo de combustible de la Utilidad Real (Σ surtidas × costo), que hoy está en cero desde el 08/07.

**El cuadre del galpón** (si el galpón sigue vivo — decisión pendiente de Máximo):
`nivel medido inicio + compras − Σ despachos = nivel medido fin`. Requiere regla del galpón pasada
al menos 2 veces por semana. Si el galpón está fuera de uso, se declara fuera de uso y el módulo
lo dice, en vez de mostrar un cuadre imposible con cero mediciones.

---

## 4. Manejo de incertidumbre: la tolerancia no puede ser un número fijo

La regla se lee en centímetros enteros (720 de 729 lecturas). Cada lectura tiene un error real de
**±1 cm** como mínimo (redondeo + camión no perfectamente nivelado + combustible que se mueve).
Cuántos litros es ese centímetro **depende de la altura**: en un tanque real la panza del medio
mueve más litros por cm que el fondo o el tope. Por eso una tolerancia fija en litros (los 15 L
actuales) está mal dos veces: es más fina que el instrumento, y es igual en la zona donde la tabla
más miente (B010 operando a 4–12 cm).

**Fórmula propuesta** (propagación de error estándar, 2 sigmas):

```
S(h)   = pendiente local de la tabla de cubicación en la altura h   [L/cm]
         (con la tabla real: (litros(h+1) − litros(h−1)) / 2 ; con la recta actual: 13,04)
σ_cm   = 1 cm        (resolución real de la regla; configurable por tanque)
σ_med(h) = S(h) × σ_cm                                  error de UNA lectura, en litros

Para un cuadre que usa la lectura de salida (h_s), la de llegada (h_l) y surtidas V:

TOL = 2 × √( (S(h_s)·σ_cm)² + (S(h_l)·σ_cm)² + (0,015·V)² )

  · 0,015·V = 1,5% del volumen surtido (error típico de contador de bomba / medida del despacho)
  · El 2 al frente = 95% de confianza: solo 1 de cada 20 cuadres limpios caería fuera por azar.
```

Con la recta actual y sin surtidas: TOL = 2×√(13²+13²) ≈ **37 L**. O sea: la alerta que hoy salta
a los 15 L recién tiene derecho a existir a los ~37, y a ser ROJA al doble (~75 L). Con la
cubicación real, S(h) será chica en el fondo del tanque y la tolerancia se achicará sola justo
donde B010 opera — la fórmula se adapta, el número fijo no. Para el cuadre semanal, las lecturas
intermedias se cancelan y solo cuentan la primera, la última y las surtidas: la misma fórmula sirve.

Regla de decisión en todas las reglas: `|residual| ≤ TOL` → limpio; `TOL < |residual| ≤ 2·TOL` →
"para observar" (se acumula, no alerta); `|residual| > 2·TOL` → anomalía con derecho a ser mostrada.

---

## 5. La cubicación real del tanque JAC

**Lo que hay que pedirle a Máximo / al taller (una vez):**

1. **Forma y medidas del tanque**: ¿cilíndrico acostado, rectangular, con esquinas redondeadas?
   Diámetro/alto (¿46 cm?), largo, ¿un tanque o dos comunicados? La capacidad "600 L" tampoco está
   verificada: si fuera un cilindro de 46 cm de diámetro, 600 L exigirían ~3,6 m de largo, que es
   mucho tanque — o no son 600 L, o no es un cilindro, o son dos tanques.
2. **El aforo real (esto es lo que vale)**: una mañana, un camión nivelado con el tanque casi
   vacío. Se carga de a tandas conocidas (bidón aforado de 20 L, o bomba con contador) y se anota
   la regla después de cada tanda: sale la tabla cm→litros VERDADERA, con 25–30 puntos. Dos
   personas, ~2 horas, un solo camión (los 12 JAC 1131 comparten tanque). Esa tabla se guarda en
   `combustible_tanques_config.tabla_cubicacion` del `tanque-jac` y **se elimina el espejo
   congelado `CL_JAC_CUB` de chofer.html** (que pase a bajar la tabla de la BD con caché local,
   como todo lo demás de la PWA) — si no, el chofer seguirá guardando litros con la recta vieja.
3. **Verificación del aforo**: la semana siguiente, el rendimiento de flota recalculado
   (`km cuadrados ÷ consumo cuadrado`) tiene que caer cerca del 1,9 km/L de referencia que dio
   Máximo. Si da 1,1 o 3,0, algo sigue mal (aforo, referencia o odómetros).

**Mientras tanto (si el aforo demora):** si el taller confirma cilindro acostado de radio r y
largo Lc, usar la fórmula del segmento circular en vez de la recta:

```
V(h) = Lc × ( r²·acos((r−h)/r) − (r−h)·√(2rh − h²) )        h = altura de la regla
```

**Asunciones explícitas**: tanque cilíndrico perfecto, montado horizontal, regla en el centro,
sin chicanas internas — todas dudosas, por eso esto es un puente y no la solución. Se valida igual
que el aforo: V(46) debe dar la capacidad real y el rendimiento semanal debe caer cerca de la
referencia. Si el tanque es rectangular, la recta actual no está tan mal en la zona media pero
miente en fondo y tope (esquinas redondeadas): razón de más para que la TOLERANCIA dependa de la
pendiente local (punto 4) hasta tener el aforo.

---

## 6. Las reglas, rediseñadas con precondiciones explícitas

Formato: qué tiene que ser VERDAD para que la regla pueda opinar; si no lo es, qué hace en cambio.
Regla general para todas: `km=0` en checklist se trata como "sin dato" (nunca como cero), las
alturas fuera de `[0, altura_max_cm]` invalidan la lectura (no se topean), y de lecturas repetidas
del mismo momento se toma **la última por `created_at`** (es la corrección del chofer), marcando la
jornada como "dato corregido" (confianza baja).

**R1 — Pérdida estacionada** (la que acusaba de robo):
- Precondiciones, TODAS: (a) la llegada previa y la salida son de **días consecutivos** de
  calendario; (b) `km_salida(hoy) == km_entrada(ayer)` con ±1 km, ambos > 0 — el odómetro DICE que
  no rodó; (c) ambas lecturas válidas y sin conflicto de duplicados; (d) sin surtida entre ambas
  (fuente única del punto 3, viva — no una tabla muerta); (e) `déficit > 2·TOL` del punto 4.
- Si se cumplen: anomalía ALTA "pérdida física en patio", dirigida a jefes, **sin nombre de
  chofer** (el custodio nocturno es el patio, no el chofer). Ej. legítimo: B008 19/07, −117 L.
- Si falla (a) o (b) porque el odómetro avanzó: la regla SE CALLA sobre robo y emite **R11**.
- Si falla porque falta el odómetro: emite R7/R12 (dato faltante). Nunca opina de merma sin km.

**R11 — Rodó sin jornada registrada** (nueva; hoy estos casos salían como "merma" = robo):
- Dispara cuando el odómetro avanzó entre dos jornadas sin checklist/mediciones de por medio
  (los 12 casos de julio: 54–208 km). Es un hallazgo operativo valioso por sí solo: la unidad se
  usó y nadie lo registró (¿viaje no facturado? ¿uso particular?). Severidad media, a operativo.
  Si además el combustible bajó MÁS que `km ÷ rendimiento de referencia + 2·TOL`, se anota el
  excedente como "para observar" — no como robo.

**R2/R4 — Consumo fuera de lo normal:**
- Precondiciones: jornada cerrada el mismo día (salida y llegada), `km del día ≥ 30` (por debajo
  manda el ruido), `km del día ≤ 350` (filtra dedazos de odómetro tipo N4; configurable por
  modelo), consumo > 0, referencia por modelo disponible (`aud_comb_rend_ref`).
- Umbral: `consumo − km/rend_ref > max(2·TOL, 35% del esperado)`. Severidad media la primera vez;
  ALTA solo si la misma unidad repite 3 veces en 14 días (el patrón es evidencia, el día suelto no).

**R5 → R13 — Combustible que entró sin registro** (rebautizada como lo que es):
- El tanque subió más de `2·TOL` sin surtida registrada (B008 18/07: +260 L). No es anécdota:
  es plata pagada fuera de libro y Utilidad Real inflada. Severidad ALTA **administrativa**,
  dirigida a oficina/socios ("registrá esta surtida con su costo"), no al chofer. Al chofer solo se
  le pregunta dónde cargó, como dato.

**R7/R9 — Falta una medición / despacho sin respaldo:** quedan como están (dato faltante, tono de
pedido al chofer), con una mejora: si `created_at` de la "salida" es de la tarde (>6 h después del
turno, caso N5), se marca "cargada tarde, posible dato de memoria" — baja la confianza del día.

**R8 — Fuera de rango / no cuadra con la tabla:** igual que hoy, pero la lectura inválida
**excluye la jornada del cuadre** (hoy 264 cm entraba topeado a 600 L). Con el espejo CL_JAC_CUB
eliminado (N3), la comparación `litros_calculados` vs tabla deja de tener dos fuentes.

**R10 — Kilometraje al revés:** solo si `km_entrada > 0` Y `km_entrada < km_salida` Y el checklist
está cerrado (no auditar jornadas del día en curso). `km_entrada=0` = jornada abierta o sin dato →
si el día ya pasó, es R12 "checklist sin cerrar" (pedido al chofer), no un absurdo matemático.

**R0 — Duplicados:** igual, más la causa raíz: `chofer.html` debe upsertear
(`onConflict: 'fecha,vehiculo_id,momento'` — requiere UNIQUE en la tabla, gotcha conocido del
repo) o incluir un token idempotente; la corrección de una lectura debe pisar, no duplicar.

**Confianza por jornada** (transversal): cada jornada queda etiquetada `completa` (dos lecturas
válidas + km + sin correcciones) / `corregida` / `incompleta`. Las reglas de sustracción solo
opinan sobre jornadas `completas`; el KPI "Días auditables" ya existe y pasa a ser el guardián:
con menos de 90% de jornadas completas en el período, el módulo lo dice arriba de todo.

---

## 7. Cómo se gana la confianza de vuelta (y cuándo se reenciende el WhatsApp)

El aviso de sustracción vuelve a encenderse por etapas, con datos, no por fe:

1. **Precondiciones + tolerancia dinámica desplegadas** (reglas del punto 6). Sin esto no hay etapa 2.
2. **Aforo real hecho y validado** (punto 5): una semana de consumos recalculados con la tabla
   nueva, y el rendimiento de flota cae en 1,9 ± 0,4 km/L. Si no cae, se investiga antes de seguir.
3. **Fuente única de surtidas viva**: al menos 2 semanas en las que TODO litro que entró a un
   camión tiene su fila en `surtidas` (el cuadre semanal del punto 3 cierra dentro de tolerancia
   para ≥ 10 de 12 unidades). Sin esto, "sin surtida que lo explique" sigue siendo una frase vacía.
4. **Modo sombra, mínimo 4 semanas**: el cron calcula las anomalías graves y las guarda en
   `combustible_alertas` con veredicto pendiente, SIN WhatsApp. Máximo o el supervisor marca cada
   una en la UI: *verdadera* (se confirmó pérdida/uso indebido) o *falsa* (error de dato). Ese
   veredicto queda guardado — es el dataset que mide al auditor.
5. **Criterio de reencendido** (`AVISAR_SUSTRACCION=true`): sobre las alertas graves del modo
   sombra, **precisión ≥ 90%** (a lo sumo 1 falsa de cada 10) con al menos 15 alertas evaluadas, y
   **cero falsos positivos graves en las últimas 2 semanas**. Con menos volumen de alertas (ojalá),
   el criterio es 4 semanas seguidas sin ninguna falsa.
6. **Aun encendido, el mensaje nunca acusa**: nombra unidad, noche y litros, y pide revisar quién
   tuvo acceso. El nombre del chofer aparece solo en los pedidos de corrección de datos, como hoy.
7. **Kill-switch automático**: si después de reencendido salen 2 alertas graves falsas seguidas
   (veredicto humano), la edge function se apaga sola (flag en `configuracion`) y avisa a socios
   que se apagó y por qué. La confianza cuesta ganarla y se pierde con una sola acusación injusta —
   el sistema tiene que saber callarse solo.

---

## 8. Orden de implementación

| # | Qué | Esfuerzo | Qué se rompe si se hace mal |
|---|---|---|---|
| 0 | ✅ HECHO (24/07): `AVISAR_SUSTRACCION=false` en la edge | — | — |
| 1 | **Precondiciones en las reglas** (punto 6): odómetro en R1, R11/R12/R13 nuevas, `km=0`→null, dedupe por última lectura, excluir alturas imposibles. En `app.js` (~1130–1490) y `auditar-combustible/index.ts`, misma lógica en los dos (norma sync: verificar el CONSUMIDOR) | 1–1,5 días | Si la UI y la edge divergen, el dashboard dice una cosa y el WhatsApp otra — es el bug de confianza de nuevo |
| 2 | **Tolerancia dinámica** (fórmula del punto 4), en ambos consumidores | 0,5 día | Tolerancia mal calibrada = o vuelve el ruido o queda sorda; dejar σ_cm y el factor 2 configurables por tanque |
| 3 | **Reactivar el registro del combustible que entra**, con `surtidas` como fuente única + corte `CORTE_GASOIL_DESPACHOS` para lo histórico. Incluye decisión de PROCESO con Máximo: quién registra el despacho EN el momento (PWA de quien despacha, con foto), y cargarle costo a la surtida de B004 que está en $0 | 2–3 días + cambio de hábito | Doble conteo `gasoil`+`surtidas` si el corte queda mal → todos los cuadres dan "apareció combustible"; y si el hábito no agarra, la auditoría vuelve a quedarse sin la pata de "qué entró" |
| 4 | ~~**Utilidad Real / Rentabilidad**: que lean surtidas~~ ⚠️ **CORREGIDO 2026-07-24 al implementar: NO se toca la fórmula.** Ver nota abajo | — | Leer surtidas ahí DUPLICARÍA el gasto |
| 5 | **Aforo del tanque JAC** (punto 5): pedido a Máximo/taller, cargar tabla real en `combustible_tanques_config`, y **eliminar `CL_JAC_CUB`** de chofer.html (que baje de la BD; bump de `CACHE_NAME` del service worker para forzar actualización en los teléfonos) | 1 mañana de patio + 0,5 día de código | Si el espejo no se mata, chofer y oficina cubican distinto para siempre; si el SW no se bumpea, los teléfonos siguen con la recta vieja semanas |
| 6 | ✅ **HECHO 2026-07-24 — Máximo lo definió: el galpón es BACKUP de emergencia.** Ver abajo | — | Pedirle regla 2×/semana a un tanque dormido = un reclamo que nadie va a cumplir |
| 7 | ✅ **HECHO 2026-07-24 — Modo sombra con veredictos.** Tabla propia `comb_auditoria_sombra` (NO `combustible_alertas`: esa es del módulo viejo de Control Combustible y manda WhatsApp a socios cuando la severidad es 'critica' — habría disparado justo lo que se quiere evitar). Botones verdadera/falsa + marcador de acierto + criterio de reencendido en pantalla. `?sombra=1` en la edge para rellenar días pasados sin encolar nada | — | Sin veredicto humano guardado no hay forma objetiva de saber cuándo reencender |
| 8 | **Reencendido del WhatsApp** según criterio 7.5, con kill-switch 7.7 | 0,5 día | Reencender por ansiedad antes del criterio = quemar la segunda (y última) oportunidad del módulo ante los choferes |

### ✅ El galpón es BACKUP DE EMERGENCIA (regla de Máximo, 2026-07-24)

Textual: *"surto del galpón cuando no consigo en la estación de servicio, así que puede durarse 1 mes
o más sin surtirse desde el galpón como después se surta siempre en galpón; el galpón es solo backup
para emergencias"*.

Eso tira abajo la propuesta de "regla 2×/semana": es un reclamo que nadie va a cumplir sobre un
tanque que nadie está tocando. El galpón tiene **dos vidas** y se auditan distinto:

- **EN REPOSO** (sin compras ni surtidas en el período): no hay nada que cuadrar — hay que
  **confirmar que el nivel no se movió**. Un tanque que nadie tocó tiene que marcar lo mismo. Es la
  prueba más barata y más fuerte que existe: dos lecturas separadas por semanas, sin movimientos en
  el medio. Si bajó, es un hallazgo de verdad y no depende de ninguna cubicación fina.
  Pedido al usuario: pasar la regla **una vez al mes** aunque no se use.
- **EN USO**: `nivel inicial + compras − surtidas = nivel final`, con regla antes y después de
  surtir. Ese es el único momento en que hacen falta las mediciones seguidas.

El módulo ya distingue los dos estados y dice cuál está viendo, en vez de mostrar un cuadre
imposible. La tolerancia del galpón pasó a la misma fórmula por instrumento (el fijo de 25 L era,
otra vez, más fino que la propia regla: el galpón mueve ~23,6 L por centímetro).

⚠️ **Esto vale SOLO para el galpón.** A los **camiones** se les sigue exigiendo la medición de
**salida y llegada todos los días** (R7 se lo reclama al chofer apenas la unidad trabajó y falta
una de las dos). Ahí no hay reposo que valga: el camión que sale, se mide.

### ⚠️ Corrección al paso 4 (verificada en el código el 2026-07-24, al implementar)

La Utilidad Real **no cuenta el combustible cuando se despacha, sino cuando se COMPRA** — y eso
está bien: el litro se paga una sola vez, al proveedor. En `_totalEgresos` son dos sumandos:
`egGas` (compras de `gasoil`, las de `cam` que empieza con COMPRA) y `egEst`
(`combustible_periodos.costo_total_usd`, los períodos de estación ya costeados). Los despachos del
galpón al camión NO se suman: son movimiento interno de un tanque que ya se pagó. Y las CxP de
combustible se excluyen aparte para no contarlo de nuevo.

Hacer que la Utilidad Real leyera `surtidas` **duplicaría el gasto** en cuanto se retomen las
compras. La fórmula no se toca.

**El hueco es de DATOS, no de código, y es más grande de lo estimado:**
- `gasoil` tiene **2 compras en toda su historia**, la última el **26/03/2026** ($3.489,71).
- `combustible_periodos`: **cero** períodos de estación costeados.
- La única surtida de estación (B004, 22/07, 200 L) está con `costo_definido=false` y `costo_usd=0`.

O sea: la Utilidad Real lleva **4 meses mostrando ganancia sin un solo dólar de combustible**.
Lo que sí se implementó es que el sistema **lo diga**: si no hay compras recientes ni períodos
costeados, el dashboard avisa arriba de todo que la Utilidad Real está inflada. Un número de plata
que no se puede sostener tiene que declararlo, no callarse.

Lo que falta acá es operativo: cargar las compras al galpón y costear los períodos de estación.

Los pasos 1–2 solos ya convierten los 12 falsos positivos de julio en hallazgos R11 correctos y
dejan vivos los 4–5 casos de N6 que de verdad merecen una pregunta. Los pasos 3–5 son los que
hacen que la frase "sin surtida que lo explique" vuelva a significar algo. Para FlotaMax se vende
exactamente esto: no "detector de robo", sino **cadena de custodia del litro con tolerancias
honestas** — que es lo que un cliente con 60 unidades puede defender delante de su gente.
