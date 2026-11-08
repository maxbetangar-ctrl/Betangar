#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// MONTA LA PANTALLA DE LLENADO EN UN REPO DE LA FAMILIA
//
//   node piezas/montar-llenado.mjs <ruta-del-repo> [--probar]
//
// Máximo, 08/11/2026: «ese reporte deberia estar en la app ... en todos los
// repos y apps».
//
// ⛔ UNA SOLA FUENTE. El módulo vive en `piezas/llenado-informe.js` y este
//    script lo INSERTA; no hay seis copias editadas a mano que se
//    desincronicen. Si el módulo cambia, se vuelve a correr esto en cada repo.
//    [[norma-dos-listas-a-mano-se-desincronizan]]
//
// ⛔ ES IDEMPOTENTE Y NO PISA NADA. Si el repo ya lo tiene, no hace nada. Cada
//    inserción se verifica después de escribir: un `replace` que no encuentra
//    su ancla NO falla, deja el archivo igual y devuelve éxito.
//    [[norma-un-reemplazo-por-valor-falla-en-silencio]]
// ═══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const MODULO = path.join(AQUI, 'llenado-informe.js')
const repo = process.argv[2]
if (!repo) { console.error('Uso: node piezas/montar-llenado.mjs <ruta-del-repo>'); process.exit(1) }

const fjs = path.join(repo, 'app.js')
const fhtml = path.join(repo, 'app.html')
for (const f of [fjs, fhtml, MODULO]) {
  if (!fs.existsSync(f)) { console.error(`⛔ falta ${f}`); process.exit(1) }
}
const nombre = path.basename(repo)
const modulo = fs.readFileSync(MODULO, 'utf8')
let js = fs.readFileSync(fjs, 'utf8')
let html = fs.readFileSync(fhtml, 'utf8')
const crlf = (s) => js.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s
const crlfH = (s) => html.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s

// ── Si ya lo tiene, se ACTUALIZA el módulo (no se duplica ni se deja viejo) ──
// Sin esto, mejorar el módulo obligaba a editar seis copias a mano, que es
// justo lo que esta pieza existe para evitar.
if (js.includes('function renderLlenado')) {
  const ini = js.indexOf('// LLENADO DE LA APP POR EMPLEADO')
  const marcaIni = js.lastIndexOf('// ═', ini) >= 0 ? js.lastIndexOf('// ═', ini) : ini
  const fin = js.indexOf('function _lleTile(lbl,val,col){', ini)
  let cierre = -1
  if (fin >= 0) {
    let prof = 0
    for (let p = js.indexOf('{', fin); p < js.length; p++) {
      if (js[p] === '{') prof++
      else if (js[p] === '}') { prof--; if (prof === 0) { cierre = p + 1; break } }
    }
    // y la función de imprimir, que va justo después
    const imp = js.indexOf('async function imprimirLlenado(', cierre)
    if (imp >= 0 && imp - cierre < 200) {
      prof = 0
      for (let p = js.indexOf('{', imp); p < js.length; p++) {
        if (js[p] === '{') prof++
        else if (js[p] === '}') { prof--; if (prof === 0) { cierre = p + 1; break } }
      }
    }
  }
  if (ini < 0 || cierre < 0) {
    console.error(`${nombre}: ⛔ ya lo tiene pero no encontré dónde empieza/termina el módulo. No se toca.`)
    process.exit(1)
  }
  const js3 = js.slice(0, marcaIni) + crlf(modulo).trimEnd() + js.slice(cierre)
  fs.writeFileSync(fjs + '.tmp', js3, 'utf8'); fs.renameSync(fjs + '.tmp', fjs)
  const sello2 = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-llenado'
  html = html.replace(/app\.js\?v=[0-9a-zA-Z-]+/g, 'app.js?v=' + sello2)
  fs.writeFileSync(fhtml + '.tmp', html, 'utf8'); fs.renameSync(fhtml + '.tmp', fhtml)
  const v = fs.readFileSync(fjs, 'utf8')
  const falta = ['function renderLlenado', 'function _lleEsc(', 'function _lleRevisar(',
    'function imprimirLlenado', 'function _llePapel('].filter(m => !v.includes(m))
  if (v.indexOf('function renderLlenado') !== v.lastIndexOf('function renderLlenado')) {
    console.error(`${nombre}: ⛔ quedó DUPLICADO`); process.exit(1)
  }
  if (falta.length) { console.error(`${nombre}: ⛔ tras actualizar falta ${falta.join(', ')}`); process.exit(1) }
  console.log(`${nombre}: módulo ACTUALIZADO (${modulo.length} car.) · ?v=${sello2}`)
  process.exit(0)
}

const pasos = []
const poner = (que, cond, fn) => { if (cond) { fn(); pasos.push(que) } else pasos.push('⚠️ ' + que + ' (sin ancla)') }

// 1 — el módulo, antes de la primera función suelta que exista en todos.
const ancla = ["var REL_TAB='pend'", 'function abrirImpresionPremium(']
  .find(a => js.includes(a))
poner('módulo JS', !!ancla, () => {
  js = js.replace(ancla, crlf(modulo) + ancla)
})

// 2 — permiso, con los MISMOS roles que la compuerta de la base.
const PERM = `
// Informe de llenado — los MISMOS roles que \`btg_ve_llenado_o_falla()\` en la base.
// ⚠️ Son dos listas a mano: si cambiás una, cambiá la otra. Manda la de la base.
['superadmin','admin','rrhh','directivo','operativo','auditor'].forEach(function(r){
  if(PERMISOS[r] && PERMISOS[r].indexOf('llenado')<0) PERMISOS[r].push('llenado');
});
`
const anclaPerm = js.includes('var NAV_LABELS=') ? 'var NAV_LABELS=' : null
poner('PERMISOS', !!anclaPerm, () => { js = js.replace(anclaPerm, crlf(PERM) + anclaPerm) })

// 3 — etiqueta del menú (sin esto el ítem se ve para CUALQUIER rol).
poner('NAV_LABELS', js.includes('var NAV_LABELS={'), () => {
  js = js.replace('var NAV_LABELS={', "var NAV_LABELS={\n  llenado:'Llenado de la app',")
})

// 4 — que se dibuje al entrar.
const anclaSp = js.match(/\n(\s*)if\(id==='dashboard'\)/)
poner('enganche en sp()', !!anclaSp, () => {
  js = js.replace(anclaSp[0],
    crlf(`\n${anclaSp[1]}if(id==='llenado'){try{renderLlenado();}catch(e){console.log('[llenado]',e&&e.message);}}`) + anclaSp[0])
})

// 5 — la página.
const PAGINA = `
<!-- LLENADO DE LA APP POR EMPLEADO — el informe para la reunión con el personal.
     ⛔ La NOTA la calcula \`btg_informe_llenado()\` en la base; acá sólo se dibuja. -->
<div class="page" id="p-llenado" style="display:none">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <div>
      <div style="font-size:18px;font-weight:800;color:var(--text1)">📝 Llenado de la app por empleado</div>
      <div style="font-size:11px;color:var(--text3)">Quién llena lo que su cargo le exige, y quién no. Elegí el período y se recalcula todo.</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="date" class="fc" id="lle-des" style="width:145px" onchange="renderLlenado()">
      <input type="date" class="fc" id="lle-hta" style="width:145px" onchange="renderLlenado()">
      <select class="fc" id="lle-rapido" style="width:150px" onchange="llenadoRapido(this.value)">
        <option value="">Período…</option>
        <option value="7">Últimos 7 días</option>
        <option value="30">Últimos 30 días</option>
        <option value="mes">Este mes</option>
        <option value="mespas">Mes pasado</option>
        <option value="todo">Todo lo medible</option>
      </select>
      <button class="btn btn-s btn-sm" onclick="renderLlenado()">Actualizar</button>
      <button class="btn btn-g btn-sm" onclick="imprimirLlenado()">🖨️ Imprimir / PDF</button>
    </div>
  </div>
  <div id="lle-body"><div style="text-align:center;color:var(--text3);padding:30px">Cargando…</div></div>
</div>
`
const anclaPag = ['<div class="page" id="p-empleados"', '<div class="page" id="p-dashboard"',
  '<div id="p-empleados" class="page"'].find(a => html.includes(a))
poner('página HTML', !!anclaPag, () => { html = html.replace(anclaPag, crlfH(PAGINA) + anclaPag) })

// 6 — el ítem del menú, en el grupo de RRHH.
const anclaMenu = html.match(/<div class="menu-item"[^>]*onclick="sp\('empleados'\)"[^>]*>[^<]*<\/div>/)
poner('ítem del menú', !!anclaMenu, () => {
  html = html.replace(anclaMenu[0], anclaMenu[0] +
    crlfH(`\n    <div class="menu-item" onclick="sp('llenado')" id="mi-llenado">📝 Llenado de la app</div>`))
})

// 7 — romper la caché. Por PATRÓN, nunca por el valor que uno cree que hay.
const sello = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-llenado'
poner('bump de caché', /app\.js\?v=[0-9a-zA-Z-]+/.test(html), () => {
  html = html.replace(/app\.js\?v=[0-9a-zA-Z-]+/g, 'app.js?v=' + sello)
})

// ── Escribir y COMPROBAR ────────────────────────────────────────────────────
fs.writeFileSync(fjs + '.tmp', js, 'utf8'); fs.renameSync(fjs + '.tmp', fjs)
fs.writeFileSync(fhtml + '.tmp', html, 'utf8'); fs.renameSync(fhtml + '.tmp', fhtml)

const js2 = fs.readFileSync(fjs, 'utf8'), html2 = fs.readFileSync(fhtml, 'utf8')
const fallos = []
const comprobar = (q, ok) => { if (!ok) fallos.push(q) }
comprobar('renderLlenado en app.js', js2.includes('function renderLlenado'))
comprobar('_lleEsc propio', js2.includes('function _lleEsc('))
comprobar("permiso 'llenado'", js2.includes("indexOf('llenado')<0"))
comprobar('NAV_LABELS', js2.includes("llenado:'Llenado de la app'"))
comprobar('enganche sp()', js2.includes("if(id==='llenado')"))
comprobar('página p-llenado', html2.includes('id="p-llenado"'))
comprobar('ítem mi-llenado', html2.includes('id="mi-llenado"'))
comprobar('caché bumpeada', html2.includes('app.js?v=' + sello))

console.log(`${nombre}: ${pasos.join(' · ')}`)
if (fallos.length) { console.error(`  ⛔ NO quedó: ${fallos.join(', ')}`); process.exit(1) }
console.log(`  ✅ las 8 comprobaciones pasan · ?v=${sello}`)
