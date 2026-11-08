// ⛔ R17 — EL GALPÓN SE MUEVE Y NADIE LO MIDE
//
// 🔴 EL HECHO, medido el 08/11/2026: los dos tanques del galpón (2.300 L cada uno, 4.600 L en
//    total) **no tienen NI UNA medición** desde que existe el sistema, y por ahí pasó combustible
//    de verdad — 11 surtidas y 2.101 L, la última el 01/11. El producto ya lo decía en la pantalla,
//    en texto GRIS, sin un solo número. Un hueco sin cifra no se prioriza: parece un detalle.
//
// 📌 EL SALDO EN LIBROS da **−1.561,23 L** (5.300 entraron, 4.760 + 2.101 salieron). Negativo es
//    físicamente imposible: un tanque no entrega más de lo que entró. Eso NO es un faltante — es
//    la prueba de que falta asentar el combustible que ya estaba cuando arrancó el registro.
//    Decirlo como faltante sería acusar a alguien con un error de papeles.
//
// ⚠️ Y LA REGLA NO ACUSA A NADIE. Es un hueco de MEDICIÓN: el combustible pudo estar perfecto
//    todo este tiempo. Lo único que se afirma es que no se puede comprobar.
//
//   node pruebas/galpon-sin-una-sola-lectura.test.mjs [app.js]
import { readFileSync } from 'fs'
import { cargarAuditoria, sembrar, auditar } from './_banco-combustible.mjs'

const rutaApp = process.argv[2] || new URL('../app.js', import.meta.url)
const js = readFileSync(rutaApp, 'utf8')

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }
const txt = (a) => String(a.msg || a.texto || a.detalle || '')

// ⛔ ESTA PRUEBA VIVE SOLO EN BETANGAR: necesita `_banco-combustible.mjs` y el volcado, y ninguno
//    de los dos existe en los clones. El MISMO cambio del motor sí se replicó a los 4, y allá lo
//    que lo protege es `ver-el-galpon-sin-medir.mjs`, que trae su propio fixture sintético —con un
//    despacho de 50.000 L de `src='Estacion'` que NO puede contarse— y lo verifica en un navegador
//    de verdad. [[norma-arreglo-en-una-es-arreglo-en-todas-misma-sesion]]
//
// ⚠️ El guardia de abajo es por si alguien corre esto sin haber bajado el volcado: entonces 0-7
//    dicen QUE NO SE MIDIERON en vez de darse por buenas. Un verde que no midió nada es peor que
//    un hueco declarado. [[norma-falta-de-dato-no-es-un-dato]]
let datos = null
try { datos = JSON.parse(readFileSync(new URL('./datos/combustible.json', import.meta.url), 'utf8')) } catch (e) { datos = null }

// El contexto se arma SIEMPRE —extraer las funciones de `app.js` no necesita datos— y solo se
// siembra cuando hay volcado. Así las aserciones 8-14 corren en los 5 repos.
const ctx = cargarAuditoria(rutaApp)
if (!datos) {
  console.log('—  0-7. (no aplica: este repo no versiona el volcado de pruebas)')
} else {
  sembrar(ctx, datos)
  // ── 0. ⛔ CONTROL POSITIVO, Y ESTE EXISTE POR UN DEFECTO REAL ────────────────────────────────
  // La primera version de R17 leia `t.capacidad_litros` —el nombre de la columna en la base— pero
  // el cargador normaliza el tanque y ahi el campo se llama `cap`. Daba `undefined`, el `||0` lo
  // convertia en capacidad CERO, y la regla se iba por su propia puerta de salida (`if(cap<=0)
  // return`) SIN DISPARAR NUNCA. No habia error: solo silencio, que se lee igual que «todo bien».
  // Si esta asercion se pone roja, ninguna de las de abajo significa nada.
  const galpones = (ctx.AC_TANQUES || []).filter((t) => t && t.tipo === 'galpon')
  ok('0. CONTROL POSITIVO: hay tanques de galpón Y con capacidad > 0',
     galpones.length > 0 && galpones.every((t) => Number(t.cap) > 0),
     'sin capacidad la regla no dispara y el hueco de 4.600 L queda invisible otra vez')
  if (!galpones.length) { console.log('\n⛔ sin tanques de galpón no se prueba nada.'); process.exit(1) }

  // ── 1. Dispara UNA VEZ, no una por jornada ──────────────────────────────────────────────────
  // ⛔ Esta asercion es la hermana de la de R16, y existe por el mismo defecto: una regla que mira
  //    UN TANQUE colocada dentro del bucle de jornadas disparo 37.827 veces en vez de 8. Pedir
  //    «mas de cero» no distingue una regla que funciona de una que grita.
  const anom = auditar(ctx, '2026-07-24', '2026-09-07')
  const r17 = anom.filter((a) => (a.cod || a.regla) === 'R17')
  ok('1. R17 dispara EXACTAMENTE una vez, no una por jornada', r17.length === 1,
     'disparó ' + r17.length + ' veces con ' + (ctx.AC_JORNADAS || []).length + ' jornadas en el rango')

  // ── 2. Lo que dice ──────────────────────────────────────────────────────────────────────────
  ok('2. dice que los tanques NO se midieron ni una vez', /no se han medido NI UNA VEZ/.test(txt(r17[0] || {})),
     'sin esa frase el aviso se lee como «falta una lectura más», no como «no hay ninguna»')
  ok('3. trae el saldo en litros, no una vaguedad', /-?[\d.,]+ L/.test(txt(r17[0] || {})),
     'un hueco sin cifra no se prioriza: es justo el defecto que esto arregla')
  ok('4. ⛔ NO ACUSA A NADIE, y lo dice con esas palabras', /NO es una acusación/.test(txt(r17[0] || {})),
     'una regla de medición que se lee como una de robo enseña a no creerle al módulo')
  ok('5. el saldo negativo se explica como un asiento que falta, NO como gasoil faltante',
     /no puede pasar/.test(txt(r17[0] || {})) && /falta asentar/.test(txt(r17[0] || {})),
     'presentar −1.561 L como faltante sería acusar con un error de papeles')
  ok('6. y dice cómo se cierra', /pasando la regla/.test(txt(r17[0] || {})),
     'un aviso sin salida es una queja')

  // ── 3. ⛔ Y NO DISPARA CUANDO YA SE PUEDE CUADRAR ───────────────────────────────────────────
  // Con dos lecturas en el rango, `_acCuadreGalpon` calcula el cuadre de verdad y lo informa él:
  // avisar ademas de que «falta medir» seria un aviso falso.
  const med0 = (datos.med || [])[0] || {}
  const conDos = JSON.parse(JSON.stringify(datos))
  const tqG = galpones[0].id
  conDos.med = (conDos.med || []).concat([
    { ...med0, id: 'g1', tanque_id: tqG, vehiculo_id: null, fecha: '2026-08-01', momento: 'salida', altura_cm: 60, created_at: '2026-08-01 08:00:00+00', corregida: false, no_confiable: false },
    { ...med0, id: 'g2', tanque_id: tqG, vehiculo_id: null, fecha: '2026-08-20', momento: 'salida', altura_cm: 55, created_at: '2026-08-20 08:00:00+00', corregida: false, no_confiable: false },
  ])
  const ctx2 = cargarAuditoria(rutaApp)
  sembrar(ctx2, conDos)
  const r17b = auditar(ctx2, '2026-07-24', '2026-09-07').filter((a) => (a.cod || a.regla) === 'R17')
  ok('7. con DOS lecturas en el rango, R17 se calla', r17b.length === 0,
     'siguió avisando que falta medir cuando el cuadre real ya se puede calcular')
}

// ── 4. `_acSrcEsTanque` — las tres respuestas ───────────────────────────────────────────────
// 🔴 EL DEFECTO QUE ESTO CIERRA: `_acSalidasGalpon` no miraba `src` y contaba como salidas del
//    galpón los **389 despachos de `src='Estacion'` (55.367 L)**, que son combustible comprado en
//    la bomba y puesto DIRECTO en el camión (el código que los escribía usa `bajarTanque=false`).
//    Eso fabrica un faltante enorme y falso, y un faltante falso señala a quien tiene la llave.
const esT = ctx._acSrcEsTanque
ok('8. Estacion NO es el tanque', esT('Estacion') === false && esT('estacion') === false, 'dio otra cosa')
ok('9. Tumaca y Boscán SÍ', esT('Tumaca') === true && esT('Boscán') === true && esT('boscan') === true,
   'un acento no puede cambiar de dónde salió el combustible')
ok('10. un nombre nuevo da null —no se adivina—', esT('Surtidor Nuevo') === null && esT('') === null && esT(null) === null,
   'adivinar acá es inventar una salida o una entrada')

// ── 5. ⛔ LA ASIMETRÍA, que es lo que impide acusar en falso ─────────────────────────────────
// En las SALIDAS la duda no se cuenta (contar una salida de más fabrica un faltante → acusa).
// En las ENTRADAS la duda sí se cuenta (dejar una compra afuera fabrica un faltante → acusa).
// Las dos empujan hacia «sobra», que es el veredicto que pide anotar un papel, no acusar.
const plano = js.replace(/\s+/g, ' ')
ok('11. las SALIDAS descartan el `src` desconocido', /if\(!_acSrcEsTanque\(g\.src\)\)return;/.test(plano),
   'un src que no reconocemos se contaría como salida del galpón y fabricaría un faltante')
ok('12. las ENTRADAS lo cuentan: solo descartan lo que sabemos que no entró',
   /if\(_acSrcEsTanque\(g\.src\)===false\)return;/.test(plano),
   'descartar una compra dudosa también fabrica un faltante — acá la duda va al otro lado')

// ── 6. Y que la pantalla lo muestre con números, no en gris ─────────────────────────────────
ok('13. la pantalla trae el saldo en libros, no solo el texto', /var sl_=_acSaldoLibrosGalpon\(\);/.test(plano),
   'el bloque volvería a ser texto gris sin una cifra')
// ⛔ ESTA SE MIDE CONTANDO LLAVES, no con una expresión regular. La primera versión era
//    `/AC_JORNADAS\.forEach\(function\(j\)\{[\s\S]*?'R17'/` y daba ROJO sobre código correcto: el
//    `[\s\S]*?` cruza el cierre del bucle y engancha cualquier `'R17'` posterior en el archivo.
//    Una regex no sabe dónde termina un bloque. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//    📌 La prueba fuerte de esto es la asersión 1 —dispara UNA vez con 184 jornadas en el rango—;
//      esta es la estructural que explica POR QUÉ, para que el día que alguien la mueva adentro
//      el mensaje diga qué hizo mal y no solo «el número cambió».
const bloquesJornadas = []
for (let i = js.indexOf('AC_JORNADAS.forEach'); i >= 0; i = js.indexOf('AC_JORNADAS.forEach', i + 1)) {
  let p = 0, k = js.indexOf('{', i)
  for (; k < js.length; k++) {
    if (js[k] === '{') p++
    else if (js[k] === '}') { p--; if (p === 0) break }
  }
  bloquesJornadas.push(js.slice(i, k))
}
ok('14. R17 vive FUERA de todo bucle de jornadas',
   bloquesJornadas.length > 0 && bloquesJornadas.every((b) => !b.includes("'R17'")),
   'está dentro de uno de los ' + bloquesJornadas.length + ' bucles de jornadas: dispararía una vez por día')

console.log('\n' + (fallos === 0 ? '✅ TODAS PASAN' : '⛔ ' + fallos + ' MAL'))
process.exit(fallos === 0 ? 0 : 1)
