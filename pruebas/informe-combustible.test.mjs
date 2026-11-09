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

// ── 1. UNA UNIDAD QUE GASTA DE MÁS, CONFIRMADA POR LAS DOS MEDIDAS ──────────────
// ⛔ Alejandra, al ver el primer informe: «¿no sería más preciso gasto de combustible
//    contra kilometraje?». Y los choferes dirán lo mismo: «un viaje a una parroquia
//    cerca no es igual que a una lejos». Por eso un hallazgo necesita que las DOS
//    medidas coincidan — litros/viaje Y km/litro.
{
  const lpv = { unidades: { norma: 20, normaKl: 2.5, filas: [
    { cam: 'U01', viajes: 200, litros: 4000, km: 10000, lv: 20, kv: 50, kl: 2.5, dif: 0, difKl: 0 },
    { cam: 'U04', viajes: 200, litros: 4000, km: 10000, lv: 20, kv: 50, kl: 2.5, dif: 0, difKl: 0 },
    { cam: 'U02', viajes: 200, litros: 5440, km: 10200, lv: 27.2, kv: 51, kl: 1.875,
      dif: 0.36, difKl: 0.25, confirmado: true },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 13440 }
  const F = api._acFrasesHallazgos(lpv, null, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')

  ok('1. señala a la unidad que gasta de más', /U02/.test(t) && /36%/.test(t),
     'sin el nombre y el porcentaje no hay de qué hablar en la reunión')
  ok('2. ⛔ trae la SEGUNDA MEDIDA: el km por litro',
     /km por litro/.test(t) && /1[.,]88|1[.,]87/.test(t) && /2[.,]50|2[.,]5\b/.test(t),
     'sin el km/L, en la reunión contestan «mi ruta es más larga» y se acabó la conversación')
  ok('2b. …y dice explícitamente que las dos coinciden',
     /no depende del largo de la ruta/.test(t) && /dicen lo mismo/.test(t),
     'que dos medidas independientes coincidan es la prueba más fuerte que hay acá')
  ok('3. pone los litros de más y la plata', /1[.,]?440 litros de m.s/.test(t) && /\$/.test(t),
     'un porcentaje sin litros ni dólares no mueve a nadie')
  ok('4. ⛔ NO acusa: manda a revisar el camión ANTES que a la persona',
     /motor|cauchos|filtros|fuga/.test(t) && !/rob|hurt|sustra/i.test(t),
     'un informe que acusa se discute en vez de usarse')
  ok('5. y los que están en la norma NO aparecen', !/U01/.test(t) && !/U04/.test(t),
     'nombrar al que está bien diluye al que no')
}

// ── 1b. LA QUE SOLO SE SALE POR VIAJE: ES LA RUTA, NO EL CAMIÓN ─────────────────
// ⛔ ESTE ES EL CONTROL QUE EVITA UNA INJUSTICIA. Sin él, alguien mira la tabla, ve
//    un +25% y le reclama a un chofer cuyo único pecado es que le tocó la parroquia
//    lejos. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
{
  const lpv = { unidades: { norma: 20, normaKl: 2.5, filas: [
    { cam: 'U05', viajes: 200, litros: 5000, km: 12500, lv: 25, kv: 62, kl: 2.5,
      dif: 0.25, difKl: 0, confirmado: false, soloViajes: true },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 5000 }
  const F = api._acFrasesHallazgos(lpv, null, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')
  ok('6. ⛔ la que solo se sale por viaje NO se presenta como culpable',
     /recorridos son m.s largos/.test(t) && /no hay nada que reclamar/i.test(t),
     'señalarla sería acusar a quien le tocó la ruta larga')
  ok('7. …y explica cuál es la medida que sirve para comparar parejo',
     /km por litro/.test(t) && /no se mueve con el largo/.test(t),
     'hay que dar la salida, no solo el descargo')
}

// ── 2. UNA QUE GASTA DE MENOS: NO ES UNA BUENA NOTICIA ───────────────────────────
{
  const lpv = { unidades: { norma: 20, normaKl: 2.5, filas: [
    { cam: 'U03', viajes: 200, litros: 2400, km: 10000, lv: 12, kv: 50, kl: 4.17,
      dif: -0.4, difKl: -0.67, confirmado: true },
  ] }, choferes: { norma: 20, filas: [] }, litSinDuenio: 0, litTotal: 2400 }
  const F = api._acFrasesHallazgos(lpv, null, [], 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')
  ok('8. ⛔ «gasta de menos» NO se presenta como virtud',
     /no es bueno|casi nunca es bueno/.test(t) && !/felicit|premi|excelente/i.test(t),
     'si se lee como ahorro, el informe premia al que no registra')
  ok('9. …y manda a revisar el REGISTRO', /no se registr|no est. anotando|anotando/.test(t),
     'hay que decir qué buscar, no solo que algo raro pasa')
}

// ── 2c. EL PAPELEO: cada cifra con la etiqueta de lo que mide ───────────────────
// 🔴 El informe decía «25 día(s) sin la planilla de viajes cargada» y ese 25 salía de
//    contar anomalías R11, que se llama «Rodó sin jornada registrada» y mide
//    KILÓMETROS entre dos lecturas. Los días sin planilla eran 69. Una etiqueta
//    puesta sobre un número que mide otra cosa inventa un dato.
{
  const lpv = { unidades: { norma: 20, filas: [] }, choferes: { filas: [] },
    diasSinPlanilla: 69, fechasSinPlanilla: 12, litSinDuenio: 0, litTotal: 0 }
  const anom = [{ cod: 'R11' }, { cod: 'R11' }, { cod: 'R12' }, { cod: 'R7' }, { cod: 'R9' }]
  const F = api._acFrasesHallazgos(lpv, null, anom, 0.7)
  const t = F.map((x) => x.t + ' ' + x.p + ' ' + x.q).join(' ')
  ok('10. ⛔ los días sin planilla salen del CONTEO real, no de las anomalías',
     /69/.test(t) && /12 fecha/.test(t),
     'el informe decía 25 porque contaba anomalías R11, que miden kilómetros')
  ok('11. ⛔ y R11 se llama por lo que mide: kilómetros, no días',
     /kil.metros rodados que no est.n en ninguna planilla/.test(t) && /2.*tramo/.test(t),
     'una etiqueta sobre un número que mide otra cosa inventa un dato')
  ok('12. cada cosa dice QUIÉN la hace', /la oficina/.test(t) && /el chofer/.test(t),
     'sin dueño, el pendiente no se mueve')
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
