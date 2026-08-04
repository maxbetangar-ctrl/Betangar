// ⛔ LA PRUEBA QUE FALTABA: el mantenimiento preventivo medía el ODÓMETRO, no el mantenimiento.
//
// Hasta el 2026-08-04, `proxServicio(km)` devolvía el siguiente múltiplo de 5.000 del kilometraje
// ACTUAL. Eso tiene dos consecuencias que ninguna prueba miraba:
//
//   1. El «faltan X km» no tiene nada que ver con cuándo se hizo el último servicio. El FC01 iba en
//      70.017 km con su cambio de aceite hecho a los 65.652 — 4.365 recorridos, faltaban 635 — y el
//      tablero decía VERDE, «faltan 4.983». Ocho veces la realidad.
//   2. Ninguna unidad podía aparecer VENCIDA jamás: el número se reinicia solo cada 5.000 km, haya
//      o no haya servicio. El JAC-B012 de Betangar estaba 88 km pasado y nadie avisaba.
//
// Esta prueba extrae las funciones del app.js REAL (no una copia) y las corre contra los datos que
// de verdad había en las bases ese día. Verificada al revés: contra el código anterior se pone roja.
//
//   node pruebas/servicio-por-aceite.test.mjs
import { readFileSync } from 'fs'

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
function extraer(nombre) {
  const ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0) throw new Error('no encontré function ' + nombre)
  return src.slice(ini, src.indexOf('\n}', ini) + 2)
}
const cuerpo = ['intervaloServicio', 'ultimoServicioKm', 'hayCicloReal', 'proxServicio']
  .map(extraer).join('\n')

// Arma el contexto con lo que la app tendría en memoria y devuelve las funciones ya cableadas.
function conFlota({ kmData = {}, unidadConfig = {}, kmGeneral = 5000 }) {
  const ctx = {
    KM_DATA: kmData,
    UNIDAD_CONFIG: unidadConfig,
    cfg: { km: kmGeneral },
    _ultimoAceiteKm: () => null,       // sin respaldo en memoria: solo lo que trae la base
  }
  const f = new Function('ctx', `with(ctx){ ${cuerpo};
    return { proxServicio, hayCicloReal, intervaloServicio, ultimoServicioKm } }`)
  return f(ctx)
}

let fallas = 0, corridas = 0
function ok(desc, real, esperado) {
  corridas++
  const bien = real === esperado
  if (!bien) fallas++
  console.log('  ' + (bien ? '✅' : '❌') + ' ' + desc + (bien ? '' : `   → dio ${real}, esperaba ${esperado}`))
}

console.log('\n1. EL CASO REAL QUE LO DESTAPÓ — FC01 de Flotilla, 2026-08-04')
{
  const api = conFlota({ kmData: { FC01: { km: 70017, ultsrv: 65652 } } })
  const km = 70017
  const prox = api.proxServicio(km, 'FC01')
  ok('el próximo servicio se cuenta desde el aceite (65.652 + 5.000)', prox, 70652)
  ok('faltan 635 km, no 4.983', prox - km, 635)
  ok('y eso lo pone en PRÓXIMO (<= 500 es amarillo; 635 aún no)', prox - km > 500, true)
  ok('tiene ciclo real, así que el dato NO es una suposición', api.hayCicloReal('FC01'), true)
}

console.log('\n2. UNA UNIDAD PUEDE ESTAR VENCIDA — JAC-B012 de Betangar, 2026-08-04')
{
  const api = conFlota({ kmData: { 'JAC-B012': { km: 11380, ultsrv: 6292 } } })
  const km = 11380
  const prox = api.proxServicio(km, 'JAC-B012')
  ok('el próximo era a los 11.292 km', prox, 11292)
  ok('está PASADO por 88 km', km - prox, 88)
  ok('el restante es negativo → VENCIDO', prox - km <= 0, true)
  // Con la fórmula vieja: (floor(11380/5000)+1)*5000 = 15000 → "faltan 3.620 km", verde.
  const viejo = (Math.floor(km / 5000) + 1) * 5000
  ok('la fórmula vieja lo daba en verde con 3.620 km por delante', viejo - km, 3620)
}

console.log('\n3. SIN CAMBIO DE ACEITE REGISTRADO NO SE INVENTA UN CICLO')
{
  const api = conFlota({ kmData: { FC17: { km: 7547, ultsrv: 0 } } })
  ok('no hay ciclo real', api.hayCicloReal('FC17'), false)
  ok('cae al redondeo del odómetro, como antes', api.proxServicio(7547, 'FC17'), 10000)
  // La pantalla marca estas con * y dice que es una suposición, no un dato.
}

console.log('\n4. EL INTERVALO ES POR UNIDAD, CON EL GENERAL DE RESPALDO')
{
  const api = conFlota({
    kmData: { CHUTO: { km: 90000, ultsrv: 88000 }, PICKUP: { km: 90000, ultsrv: 88000 } },
    unidadConfig: { CHUTO: { kmServicio: 10000 } },   // una chuto no es una camioneta
    kmGeneral: 5000,
  })
  ok('la chuto usa su propio intervalo', api.intervaloServicio('CHUTO'), 10000)
  ok('la pickup usa el general', api.intervaloServicio('PICKUP'), 5000)
  ok('y eso cambia el próximo: chuto a 98.000', api.proxServicio(90000, 'CHUTO'), 98000)
  ok('pickup a 93.000', api.proxServicio(90000, 'PICKUP'), 93000)
  ok('unidad desconocida no rompe: usa el general', api.intervaloServicio('NO_EXISTE'), 5000)
}

console.log('\n5. NO SE CUENTA CUALQUIER TRABAJO COMO SERVICIO')
{
  // El FC16 solo tenía "Pulmon de Cabina" (item_id vacío). No es un cambio de aceite, así que la
  // base deja ult_srv en 0 y acá NO puede aparecer un ciclo inventado.
  const api = conFlota({ kmData: { FC16: { km: 256707, ultsrv: 0 } } })
  ok('un pulmón de cabina no reinicia la cuenta', api.hayCicloReal('FC16'), false)
}

console.log('\n' + (fallas ? `❌ ${fallas} de ${corridas} fallaron` : `✅ todo en verde (${corridas} comprobaciones)`))
process.exit(fallas ? 1 : 0)
