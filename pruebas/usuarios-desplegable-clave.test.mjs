// ⛔ LA PRUEBA QUE FALTABA: las DOS listas de la pantalla de Usuarios salen de la MISMA fuente.
//
// Lo reportó Alejandra el 15/09/2026, en Tony Gas: «al momento de seleccionar los
// usuarios, la lista que despliega no corresponde (es de betangar)». Le habían
// pedido cambiarle la clave a Katty y no pudo: Katty NO estaba en el desplegable,
// aunque sí estaba en la tabla de arriba, en la misma pantalla.
//
// LA CAUSA. La TABLA (`tb-usuarios`) se llenaba de la API —los usuarios reales de esa
// empresa—, y el desplegable de «Cambiar Contraseña» (`cp-user`) se llenaba del objeto
// `USUARIOS` escrito en el código, que en un clon es la lista del MOLDE: `maxbetangar`,
// `betangarvisor`, `operador1`, `rrhh1`… Dos listas del mismo tablero, dos fuentes.
//
// Esta prueba recorre EL CAMINO REAL —`renderUsuarios()` con la API respondiendo— y no
// la función suelta, porque el defecto no estaba en cómo se pinta una lista: estaba en
// de dónde salía. Verificada al revés: llenando `cp-user` desde `USUARIOS`, se pone roja.
//
//   node pruebas/usuarios-desplegable-clave.test.mjs
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const app = require('../test/harness')

let fallas = 0
const revisar = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  console.log(`${ok ? '✅' : '🔴'} ${que}${ok ? '' : `\n     esperado ${JSON.stringify(esperado)}\n     dio      ${JSON.stringify(real)}`}`)
  if (!ok) fallas++
}

// Una casilla de verdad donde mirar lo que se pintó: el harness devuelve un elemento
// NUEVO en cada getElementById, así que hay que fijar uno.
function montarPantalla() {
  const cp = { innerHTML: '', value: '' }
  const tb = { innerHTML: '' }
  app.document.getElementById = (id) => (id === 'cp-user' ? cp : id === 'tb-usuarios' ? tb : { innerHTML: '', value: '', style: {} })
  return { cp, tb }
}
const opciones = (cp) => (cp.innerHTML.match(/value="([^"]*)"/g) || [])
  .map((s) => s.slice(7, -1)).filter(Boolean)

// ── La empresa de este clon, según la API (los de verdad) ──────────────────────
const LOS_DE_LA_EMPRESA = [
  { usuario: 'katty', nombre: 'Katty Sulbarán', rol: 'operador', activo: true },
  { usuario: 'sandra', nombre: 'Sandra Verdi', rol: 'admin', activo: true },
  { usuario: 'arnaldo', nombre: 'Arnaldo', rol: 'mantenimiento', activo: false },
]

;(async function () {
  // ── 1. El caso de Alejandra ────────────────────────────────────────────────
  var p = montarPantalla()
  app.btgUsuariosAPI = async () => ({ ok: true, usuarios: LOS_DE_LA_EMPRESA })
  await app.renderUsuarios()

  revisar('el desplegable trae a la gente de la empresa', opciones(p.cp), ['katty', 'sandra', 'arnaldo'])
  revisar('y a Katty, que es lo que no se podía hacer', opciones(p.cp).includes('katty'), true)

  // ⛔ Lo que delataba el defecto: nombres del MOLDE que no son de esta empresa.
  const delatores = Object.keys(app.USUARIOS).filter((u) => opciones(p.cp).includes(u) && !LOS_DE_LA_EMPRESA.some((x) => x.usuario === u))
  revisar('no se cuela ningún usuario del molde', delatores, [])

  // ── 2. Las dos listas de la pantalla dicen lo MISMO ────────────────────────
  const enLaTabla = (p.tb.innerHTML.match(/font-weight:700">([^<]*)</g) || []).map((s) => s.replace(/.*">/, '').replace('<', ''))
  revisar('la tabla y el desplegable traen la misma gente', opciones(p.cp), enLaTabla)

  // ── 3. Un inactivo se ofrece, pero DICHO ───────────────────────────────────
  // Se le puede cambiar la clave a alguien desactivado (es parte de reactivarlo),
  // pero quien elige tiene que saberlo.
  revisar('al inactivo se le nota', /arnaldo[^<]*\(inactivo\)/.test(p.cp.innerHTML), true)

  // ── 4. Si la lista NO carga, lo DICE ───────────────────────────────────────
  // ⛔ Un desplegable vacío se ve igual que una empresa sin usuarios.
  p = montarPantalla()
  app.btgUsuariosAPI = async () => ({ ok: false, error: 'HTTP 500' })
  await app.renderUsuarios()
  revisar('sin lista, el desplegable no queda mudo', /no se pudo cargar la lista/.test(p.cp.innerHTML), true)
  revisar('y dice por qué', /HTTP 500/.test(p.cp.innerHTML), true)
  revisar('y no ofrece a nadie', opciones(p.cp), [])

  console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\n✅ todo bien')
  process.exit(fallas ? 1 : 0)
})()
