// ⛔ UNA BARRA SIN RÓTULO HEREDA EL SIGNIFICADO DE LA TARJETA QUE LA CONTIENE.
//
// 02/10/2026, Máximo: «la Alcaldía me ha abonado el 59% y me debe el 41%, no me cuadra». No
// cuadraba porque era al revés: medido contra la base, está facturado el 42% de lo ejecutado
// (1.975 de 4.701 viajes) y sin facturar el 58%.
//
// El cálculo de app.js NUNCA estuvo mal: `pct = totalCob/totalM` = 42, correcto. Lo que estaba
// mal era DÓNDE se dibujaba. La barra `s-pbar` vivía dentro de la tarjeta «Por Cobrar» de
// app.html, sin rótulo y sin número. Al 42% de cobrado, la tarjeta ROJA aparecía llena al 42%:
// se leía «42% por cobrar» y, por complemento, «58% cobrado». Meses de dashboard diciendo lo
// contrario de lo que medía, sin una sola línea de cálculo equivocada.
//
// Y de paso: `s-pbar` se pintaba para TODOS los roles, RRHH incluido, que tiene el cobrado
// restringido. Un número restringido también se filtra DIBUJADO. Además el 'Restringido' de
// `s-cobrado-sub` lo pisaba la línea siguiente: era texto muerto.
//
// Verificada al revés: contra el código anterior (git stash / git show) los casos 1, 3, 4, 5 y 6
// se ponen ROJOS.
//   node pruebas/barra-en-la-tarjeta-correcta.test.mjs [app.html] [app.js]
import { readFileSync } from 'fs'

const html = readFileSync(process.argv[2] || new URL('../app.html', import.meta.url), 'utf8')
const js   = readFileSync(process.argv[3] || new URL('../app.js',   import.meta.url), 'utf8')

let fallos = 0
const ok = (n, cond, detalle) => {
  console.log((cond ? '✅' : '❌') + ' ' + n + (cond ? '' : '  → ' + detalle))
  if (!cond) fallos++
}

// Devuelve la LÍNEA que contiene a id="<id>". Cada tarjeta del dashboard ocupa una línea
// entera, así que la línea ES la tarjeta. ⚠️ El primer intento de este helper recortaba desde
// el último `<div class="stat` anterior y picaba en `stat-val` / `stat-sub` — que también
// empiezan por «stat» — devolviendo media tarjeta, sin su rótulo, y daba un falso ROJO.
const LINEAS = html.split('\n').map(l => l.replace(/\r$/, ''))
const tarjetaDe = (id) => LINEAS.find(l => l.includes('id="' + id + '"')) || null
const rotuloDe = (frag) => {
  const m = frag && frag.match(/class="stat-lbl"[^>]*>([^<]+)</)
  return m ? m[1].trim() : null
}

// ── 1. La barra vive en la tarjeta «Cobrado», que es lo que mide ──────────────
const tCob = tarjetaDe('s-cobrado')
const tPor = tarjetaDe('s-porcobrar')
ok('1. s-pbar está en la tarjeta "Cobrado"',
   !!tCob && tCob.includes('id="s-pbar"') && rotuloDe(tCob) === 'Cobrado',
   'la barra mide cobrado/ejecutado y está en la tarjeta "' + rotuloDe(tarjetaDe('s-pbar')) + '"')

ok('2. s-pbar NO está en la tarjeta "Por Cobrar"',
   !!tPor && !tPor.includes('id="s-pbar"') && rotuloDe(tPor) === 'Por Cobrar',
   'una barra al 42% dentro de la caja roja se lee "42% por cobrar"')

// ── 2. Cada tarjeta IMPRIME su porcentaje: una barra muda vuelve a mentir ─────
ok('3. el sub de Cobrado imprime su %',
   /g\('s-cobrado-sub'\)\.textContent=[^;]*\+pct\+/.test(js),
   'sin el número escrito, mover la barra de caja vuelve a invertir la lectura')

ok('4. el sub de Por Cobrar imprime su %',
   /g\('s-porcobrar-sub'\)\.textContent=[^;]*\(100-pct\)/.test(js),
   'la tarjeta roja no dice qué fracción es')

// ── 3. RRHH tiene el cobrado restringido: tampoco lo ve DIBUJADO ──────────────
const iR = js.indexOf('if(_esRRHH){')
const ramaRRHH = iR < 0 ? '' : js.slice(iR, js.indexOf('}else{', iR))
ok('5. con rol rrhh la barra queda en 0%',
   /s-pbar'\)\.style\.width='0%'/.test(ramaRRHH),
   'la barra filtraba el ratio cobrado/ejecutado a un rol que no puede verlo')

ok('6. con rol rrhh el sub de Cobrado no se pisa con los viajes',
   ramaRRHH.includes("'Restringido'") && !/vCobV/.test(ramaRRHH),
   'el Restringido lo sobrescribía la línea siguiente')

console.log(fallos ? '\n' + fallos + ' fallo(s)' : '\nTodo en verde (6)')
process.exit(fallos ? 1 : 0)
