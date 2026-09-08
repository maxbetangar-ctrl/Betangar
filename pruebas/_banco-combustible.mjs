// Banco para correr la AUDITORÍA DE COMBUSTIBLE REAL contra un volcado real de la base.
// Extrae las funciones de `app.js` (no una copia) y las corre en un `vm` con los globales que
// la auditoría espera. Sirve para probar y para barrer: `_acAnomalias` sale tal cual la ve el
// cliente en pantalla.
import { readFileSync } from 'fs'
import vm from 'node:vm'

const RUTA_APP = new URL('../app.js', import.meta.url)

function trozo(src, nombre, opcional = false){
  const ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0){ if (opcional) return ''; throw new Error('no encontré function ' + nombre) }
  // hasta el primer `\n}` a nivel de columna 0
  const fin = src.indexOf('\n}', ini)
  if (fin < 0) throw new Error('no cerré function ' + nombre)
  return src.slice(ini, fin + 2)
}

const FUNCS = ['_acHoy','_acNum','_acFmt','_acUsd','_acCubicar','_acLitrosPorCm','_acTol',
  '_acDiaSiguiente','_acAlturaValida','_acLotesSurtidas','_acSurtidaUbicable','_acEntradas',
  '_acEntradasSinHora','_acTanqueDe','_acEsGalpon','_acDedupe','_acArmarJornadas','_acRefModelo',
  '_acRefRend','_acTs','_acAntesDe','_acAnomalias']

export function cargarAuditoria(rutaApp = RUTA_APP){
  const src = readFileSync(rutaApp, 'utf8')
  const ctx = {
    AC_TANQUES:[], AC_MED:[], AC_GASOIL:[], AC_SURTIDAS:[], AC_CK:[], AC_JORNADAS:[],
    AC_ANOM:[], AC_META:{}, AC_SALIDAS_TANQUE:[], FLOTA:{}, _AC_LOTES:null, UNIDAD_CONFIG:{},
    AC_TOL_PISO:null, AC_SIGMA_CM:null,   // se leen del app.js real más abajo
    formatFecha:(f)=>String(f||'').slice(0,10).split('-').reverse().join('/'),
    _fmtFecha:(f)=>String(f||'').slice(0,10).split('-').reverse().join('/'),
    _lblUnidad:(c)=>String(c),
    console, Math, Date, String, Number, Object, Array, JSON, isNaN, parseFloat, parseInt,
  }
  vm.createContext(ctx)
  // Las constantes de tolerancia salen del archivo REAL, sí o sí: si no están, se para. Puestas
  // a ojo, el banco mide con otra vara que la pantalla —con σ=0,5 la B003 del 30/08 daba ±18 L
  // y la real es ±32— y una prueba calibrada distinto del producto no prueba el producto.
  for (const nom of ['AC_SIGMA_CM', 'AC_TOL_PISO']) {
    const m = src.match(new RegExp('var ' + nom + '\\s*=[^;\\n]*;'))
    if (!m) throw new Error('no encontré ' + nom + ' en el app.js — el banco mediría con otra vara')
    vm.runInContext(m[0], ctx)
  }
  // Las de la corrección del 07/09 son opcionales: así el MISMO banco corre contra el código
  // ANTERIOR (`git show HEAD:app.js`) y se comprueba que la prueba se pone ROJA sin ellas.
  const NUEVAS = { _acLotesSurtidas:1, _acSurtidaUbicable:1 }
  const BR = String.fromCharCode(10)
  vm.runInContext(FUNCS.map(f => trozo(src, f, !!NUEVAS[f])).join(BR), ctx)
  return ctx
}

// Mete el volcado real de la base en los globales de la auditoría, tal como lo hace `acCargar`.
export function sembrar(ctx, datos, { corteSurtidas = '2026-07-24' } = {}){
  ctx.AC_TANQUES = datos.tanques.map(t => ({
    id:t.id, nombre:t.nombre, tipo:t.tipo, cap:Number(t.capacidad_litros),
    hmax:Number(t.altura_max_cm), tabla:t.tabla_cubicacion || null,
  }))
  ctx.AC_MED      = ctx._acDedupe(datos.med)
  ctx.AC_SURTIDAS = datos.surt
  ctx.AC_GASOIL   = datos.gasoil
  ctx.AC_CK       = datos.ck
  ctx.AC_META     = { corteSurtidas, rendRefMapa:{ 'jac':1.9 }, modeloCam:{}, corregidas:{}, noConf:{} }
  const cams = [...new Set(datos.med.map(m => String(m.vehiculo_id||'')))].filter(Boolean)
  cams.forEach(c => {
    ctx.FLOTA[c] = {}
    ctx.AC_META.modeloCam[c] = 'JAC 1131'
    ctx.UNIDAD_CONFIG[c] = { capacidad_tanque_l: 600 }   // los 12 JAC 1131 de Betangar
  })
  return cams
}

// Corre la auditoría completa de un período y devuelve las anomalías, como en pantalla.
export function auditar(ctx, desde, hasta){
  const todas = ctx._acArmarJornadas(desde, hasta)
  const ref = ctx._acRefRend(todas)
  return ctx._acAnomalias(todas, desde, hasta, ref)
}
