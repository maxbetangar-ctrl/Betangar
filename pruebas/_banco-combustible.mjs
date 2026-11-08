// Banco para correr la AUDITORÍA DE COMBUSTIBLE REAL contra un volcado real de la base.
// Extrae las funciones de `app.js` (no una copia) y las corre en un `vm` con los globales que
// la auditoría espera. Sirve para probar y para barrer: `_acAnomalias` sale tal cual la ve el
// cliente en pantalla.
import { readFileSync } from 'fs'
import vm from 'node:vm'

const RUTA_APP = new URL('../app.js', import.meta.url)

function trozo(src, nombre, opcional = false){
  let ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0){ if (opcional) return ''; throw new Error('no encontré function ' + nombre) }
  // ⛔ SI ES `async function`, EL `async` VA ADENTRO. Cortar en `function` deja un cuerpo con
  //    `await` dentro de una función común y el `vm` muere con un SyntaxError que apunta a una
  //    línea del archivo generado, no del fuente. (Costó un intento el 07/11 con `_acPaginar`.)
  if (src.slice(Math.max(0, ini - 6), ini) === 'async ') ini -= 6
  // hasta el primer `\n}` a nivel de columna 0
  const fin = src.indexOf('\n}', ini)
  if (fin < 0) throw new Error('no cerré function ' + nombre)
  return src.slice(ini, fin + 2)
}

// ⛔ `_acSigmaDe` FALTABA y rompio 5 pruebas en silencio desde el 06/11: se agrego a app.js
//    ese dia (la tolerancia sale de la PRECISION de la lectura) y esta lista no se actualizo.
//    `_acTol` la llama, asi que toda prueba que armara una jornada reventaba con
//    «_acSigmaDe is not defined» — y nadie lo vio porque las pruebas no las corre nadie solo.
//    📌 Una lista de funciones a mano se desincroniza del codigo que extrae.
//    [[norma-dos-listas-a-mano-se-desincronizan]]
//    🔴 Y VOLVIÓ A PASAR el 07/11 con `_acDespDelCuadre`: misma lista, mismo síntoma, misma
//    prueba reventada. Dos veces alcanza. Ahora la lista SE CONTROLA SOLA (ver `faltantes`):
//    si el código extraído llama a un `_acAlgo` que no está acá, el banco se para y lo NOMBRA,
//    en vez de explotar adentro de un `vm` con un «is not defined» sin contexto.
const FUNCS = ['_acHoy','_acNum','_acFmt','_acUsd','_acCubicar','_acLitrosPorCm','_acTol','_acSigmaDe',
  '_acDiaSiguiente','_acAlturaValida','_acLotesSurtidas','_acSurtidaUbicable','_acEntradas',
  '_acEntradasSinHora','_acCargaEnLote','_acTanqueDe','_acEsGalpon','_acDedupe','_acArmarJornadas','_acRefModelo',
  '_acRefRend','_acTs','_acAntesDe','_acAnomalias','_acDespDelCuadre','_acVeredictoNoche','_acCuadreSemanal','_acLunesDe','_acMenos','_acCostoL']

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
  // Las que aparecieron DESPUÉS: si no están, es que se está corriendo contra el código anterior
  // —que es justo para lo que sirve este banco— y ese código no las usa. Si estuvieran y no se
  // leyeran, el banco mediría con otra vara; por eso se leen del archivo igual que las de arriba.
  for (const nom of ['AC_NOCHE_DIAS_MAX']) {
    const m = src.match(new RegExp('var ' + nom + '\\s*=[^;\\n]*;'))
    if (m) vm.runInContext(m[0], ctx)
  }
  // Las de la corrección del 07/09 son opcionales: así el MISMO banco corre contra el código
  // ANTERIOR (`git show HEAD:app.js`) y se comprueba que la prueba se pone ROJA sin ellas.
  // Opcionales: las que existen en una versión y no en la otra, para que el MISMO banco
  // pueda correr contra el código anterior y mostrar en qué se pone rojo.
  const NUEVAS = { _acLotesSurtidas:1, _acSurtidaUbicable:1, _acEntradasSinHora:1, _acCargaEnLote:1,
                   _acDespDelCuadre:1, _acVeredictoNoche:1, _acCuadreSemanal:1, _acLunesDe:1 }
  const BR = String.fromCharCode(10)
  const codigo = FUNCS.map(f => trozo(src, f, !!NUEVAS[f])).join(BR)

  // ⛔ LA LISTA SE CONTROLA SOLA. Lo que se extrae puede llamar a otro `_acAlgo` que no esté en
  //    FUNCS, y entonces el `vm` revienta con «_acX is not defined» y un stack que no dice qué
  //    hay que hacer. Pasó dos veces (`_acSigmaDe` el 06/11, `_acDespDelCuadre` el 07/11). Acá
  //    se mira qué llama el código extraído y se exige que esté — nombrando lo que falta.
  //    ⚠️ Se buscan llamadas `_acAlgo(` que NO vengan precedidas de un punto (eso sería un
  //    método de un objeto, no una función suelta del archivo).
  const llamadas = new Set((codigo.match(/(^|[^.\w])_ac[A-Za-z0-9_]*\s*\(/g) || [])
    .map(s => (s.match(/_ac[A-Za-z0-9_]*/) || [''])[0]))
  // ⚠️ Lo definido ADENTRO de lo extraído no falta: `_acTurno` es una `var` local de
  //    `_acArmarJornadas`, y pedirla en FUNCS sería pedir una función que no existe suelta.
  const propias = new Set((codigo.match(/(?:function|var|let|const)\s+_ac[A-Za-z0-9_]*/g) || [])
    .map(s => (s.match(/_ac[A-Za-z0-9_]*/) || [''])[0]))
  // Las que el banco NO provee a proposito, con el motivo al lado: una exencion sin motivo
  // escrito es el lugar donde se esconden las de verdad.
  const EXENTAS = { _acPaginar: 'baja filas de la base; el banco siembra el volcado a mano' }
  const faltantes = [...llamadas].filter(n => n && !FUNCS.includes(n) && !propias.has(n)
                                           && !(n in EXENTAS) && !(n in ctx))
  if (faltantes.length) {
    throw new Error('el banco extrae código que llama a ' + faltantes.join(', ') +
      ', y no está(n) en FUNCS de pruebas/_banco-combustible.mjs. Agregalas ahí ' +
      '(y a NUEVAS si no existen en la versión anterior de app.js).')
  }
  vm.runInContext(codigo, ctx)
  return ctx
}

// Mete el volcado real de la base en los globales de la auditoría, tal como lo hace `acCargar`.
// ⛔ LA CONFIGURACIÓN SALE DEL VOLCADO, NO DE ACÁ. Dos veces el 08/09 este banco midió con otra
// vara que el producto —la σ de la regla puesta a ojo (0,5 cuando la real es 1) y el corte de
// surtidas en 24/07 cuando el real es 18/07— y la prueba pasaba midiendo otra cosa. Si falta un
// valor, se PLANTA: un banco que rellena lo que no sabe no prueba nada.
// [[norma-test-que-pasa-por-el-motivo-equivocado]] · [[norma-respaldo-que-inventa-un-dato]]
export function sembrar(ctx, datos){
  const cfg = {}
  ;(datos.cfg || []).forEach((r) => { cfg[r.clave] = r.valor })
  for (const k of ['surtidas_corte', 'aud_comb_rend_ref']) {
    if (!cfg[k]) throw new Error('falta `' + k + '` en el volcado — corré `node pruebas/datos/bajar.mjs`')
  }
  if (!datos.unidades || !datos.unidades.length) throw new Error('falta `unidades` en el volcado')

  ctx.AC_TANQUES = datos.tanques.map((t) => ({
    id:t.id, nombre:t.nombre, tipo:t.tipo, cap:Number(t.capacidad_litros),
    hmax:Number(t.altura_max_cm), tabla:t.tabla_cubicacion || null,
  }))
  ctx.AC_MED      = ctx._acDedupe(datos.med)
  ctx.AC_SURTIDAS = datos.surt
  ctx.AC_GASOIL   = datos.gasoil
  ctx.AC_CK       = datos.ck
  ctx.AC_META     = {
    corteSurtidas: String(cfg.surtidas_corte).replace(/"/g, ''),
    rendRefMapa:   JSON.parse(cfg.aud_comb_rend_ref),
    modeloCam:     {}, corregidas:{}, noConf:{},
  }
  datos.unidades.forEach((u) => {
    ctx.FLOTA[u.cam] = {}
    ctx.AC_META.modeloCam[u.cam] = u.modelo || ''
    ctx.UNIDAD_CONFIG[u.cam] = { capacidad_tanque_l: Number(u.capacidad_tanque_l) || null }
  })
  return datos.unidades.map((u) => u.cam)
}

// Corre la auditoría completa de un período y devuelve las anomalías, como en pantalla.
export function auditar(ctx, desde, hasta){
  const todas = ctx._acArmarJornadas(desde, hasta)
  const ref = ctx._acRefRend(todas)
  return ctx._acAnomalias(todas, desde, hasta, ref)
}
