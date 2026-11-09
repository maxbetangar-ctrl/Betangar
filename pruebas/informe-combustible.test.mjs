// ═══════════════════════════════════════════════════════════════════════════════
// 🖨️ EL INFORME PARA LA REUNIÓN: QUE LA REDACCIÓN DIGA LO QUE TIENE QUE DECIR
//
// 🔴 LO PIDIÓ MÁXIMO (08/11/2026): *«aparte del reporte, un medio informe de qué
//    notaste, pero de manera que lo entienda cualquier persona, para poder tomar
//    decisiones… bueno, tal y tal unidad están usando más combustible que el resto y
//    eso no es normal porque son los mismos kilómetros, y así»*.
//
// ⛔ LO QUE SE PROTEGE ACÁ NO ES UNA CUENTA, ES UN TEXTO — y es más frágil que una
//    cuenta, porque nada lo contradice si está mal escrito. Tres cosas:
//      1. que el hallazgo traiga su CIFRA (sin número no se decide nada);
//      2. que traiga el DESCARGO (los mismos kilómetros), porque sin eso el que lo
//         lee en la reunión tiene la respuesta lista: «es que mi ruta es más larga»;
//      3. que NO acuse. La diferencia entre «gasta 36% más» y «se está robando el
//         gasoil» es la que sostiene o rompe una reunión.
//         [[norma-una-asercion-mal-escrita-acusa-al-producto]]
//
// ⚠️ LO QUE NO PRUEBA: no prueba que el informe se vea bien impreso — eso se mira en
//    el navegador — ni que el hallazgo sea cierto; eso lo prueban las reglas.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const js = readFileSync(path.join(AQUI, '..', 'app.js'), 'utf8')

let fallos = 0
const ok = (n, c, d) => { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  → ' + d)); if (!c) fallos++ }

const saca = (nombre) => {
  const i = js.indexOf('function ' + nombre + '(')
  if (i < 0) return null
  let p = 0, fin = -1
  for (let k = js.indexOf('{', i); k < js.length; k++) {
    if (js[k] === '{') p++
    else if (js[k] === '}') { p--; if (p === 0) { fin = k + 1; break } }
  }
  return js.slice(i, fin)
}

const fF = saca('_acFrasesHallazgos'), fI = saca('acImprimirInforme')
ok('0. CONTROL POSITIVO: las dos funciones existen', !!fF && !!fI,
   'falta: ' + [['_acFrasesHallazgos', fF], ['acImprimirInforme', fI]].filter((x) => !x[1]).map((x) => x[0]).join(', '))
if (!fF || !fI) { console.log('\n⛔ sin las funciones no se prueba nada.'); process.exit(1) }

const api = new Function('_acFmt', '_lblUnidad',
  fF + '\n return {_acFrasesHallazgos:_acFrasesHallazgos};')(
  (n, d) => (n == null ? '—' : Number(n).toFixed(d == null ? 0 : d)),
  (c) => String(c))

// ── 1. UNA UNIDAD QUE GASTA DE MÁS ───────────────────────────────────────────────
{
  // Tres unidades, no dos: con dos, la mediana de km incluye a la propia acusada y la
  // comparacion se vuelve trivial. Con tres, el "resto" es de verdad el resto.
  const lpv = { unidades: { norma: 20, filas: [
    { cam: 'U01', viajes: 200, litros: 4000, lv: 20, kv: 50, dif: 0 },
    { cam: 'U04', viajes: 200, litros: 4000, lv: 20, kv: 50, dif: 0 },
    { cam: 'U02', viajes: 200, litros: 5440, lv: 27.2, kv: 51, dif: 0.36 },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 13440 }
  const F = api._acFrasesHallazgos(lpv, null, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')

  ok('1. señala a la unidad que gasta de más', /U02/.test(t) && /36%/.test(t),
     'sin el nombre y el porcentaje no hay de qué hablar en la reunión')
  ok('2. ⛔ trae el DESCARGO: que los kilómetros son los mismos',
     /no es porque haga rutas m.s largas/.test(t) && /51/.test(t) && /50/.test(t),
     'sin eso, en la reunión contestan «mi ruta es más larga» y se acabó la conversación')
  ok('3. pone los litros de más y la plata', /1[.,]?440 litros de m.s/.test(t) && /\$/.test(t),
     'un porcentaje sin litros ni dólares no mueve a nadie')
  ok('4. ⛔ NO acusa: manda a revisar el camión ANTES que a la persona',
     /motor|cauchos|filtros|fuga/.test(t) && !/rob|hurt|sustra/i.test(t),
     'un informe que acusa se discute en vez de usarse')
  ok('5. y los que están en la norma NO aparecen', !/U01/.test(t) && !/U04/.test(t),
     'nombrar al que está bien diluye al que no')
}

// ── 2. UNA QUE GASTA DE MENOS: NO ES UNA BUENA NOTICIA ───────────────────────────
{
  const lpv = { unidades: { norma: 20, filas: [
    { cam: 'U03', viajes: 200, litros: 2400, lv: 12, kv: 50, dif: -0.4 },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 2400 }
  const F = api._acFrasesHallazgos(lpv, null, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')
  ok('6. ⛔ «gasta de menos» NO se presenta como virtud',
     /no es bueno|casi nunca es bueno/.test(t) && !/felicit|premi|excelente/i.test(t),
     'si se lee como ahorro, el informe premia al que no registra')
  ok('7. …y manda a revisar el REGISTRO', /no se registr|no est. anotando|anotando/.test(t),
     'hay que decir qué buscar, no solo que algo raro pasa')
}

// ── 3. EL TANQUE ─────────────────────────────────────────────────────────────────
{
  const saldo = { nuncaMedido: true, entradas: 5300, salidas: 4760, saldo: 540 }
  const F = api._acFrasesHallazgos({ unidades: { filas: [] }, choferes: { filas: [] } }, saldo, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')
  ok('8. el tanque: dice lo que entró, lo que salió y lo que debería quedar',
     /5300/.test(t) && /4760/.test(t) && /540/.test(t),
     'los tres números juntos son lo que hace entendible el tema')
  ok('9. …y dice que se cierra con UNA medición', /pasarle la regla una vez|regla una vez/.test(t),
     'sin la salida concreta, el hallazgo queda como una queja')
}

// ── 4. CONTROL NEGATIVO: sin nada fuera de norma, no inventa hallazgos ───────────
{
  const lpv = { unidades: { norma: 20, filas: [
    { cam: 'U01', viajes: 200, litros: 4000, lv: 20, kv: 50, dif: 0 },
    { cam: 'U02', viajes: 200, litros: 4200, lv: 21, kv: 50, dif: 0.05 },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 8200 }
  const F = api._acFrasesHallazgos(lpv, { nuncaMedido: false, entradas: 0, salidas: 0, saldo: 0 }, [], 0.7)
  ok('10. CONTROL NEGATIVO: con todo en orden NO inventa hallazgos', F.length === 0,
     'dio ' + F.length + ': un informe que siempre encuentra algo deja de creerse')
}

// ── 5. EL INFORME SE NIEGA A SALIR A MEDIAS ──────────────────────────────────────
ok('11. ⛔ sin período analizado, el informe NO se genera', /Primero analiz/.test(fI),
   'un informe armado sobre una pantalla vacía sale con ceros y parece real')
ok('12. y el informe dice hasta dónde llega', /Hasta d.nde llega este informe/.test(fI),
   'un informe que no dice qué parte miró invita a que se lo discuta entero')

console.log(fallos ? `\n⛔ ${fallos} MAL` : '\n✅ TODAS PASAN')
process.exit(fallos ? 1 : 0)
