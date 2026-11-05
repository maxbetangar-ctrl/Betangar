#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════
// PROBAR LAS RPC DEL CHOFER DESPUÉS DE LA MIGRACIÓN DE LOS DOS TURNOS
//
// ⛔ POR QUÉ. La migración BORRÓ las versiones de dos argumentos de `chofer_checklist_dia` y
//    `chofer_viajes_dia` para recrearlas con `p_turno`. La app del chofer está VIVA y las
//    llama con dos argumentos: si el parámetro por defecto no alcanzara, o si los permisos
//    de `anon` no hubieran vuelto, mañana a las 5:40 los doce choferes se encuentran con que
//    no pueden abrir su checklist — y el error se leería como «la app no sirve».
//    Se prueba CON LA LLAVE ANON, que es la que usa el teléfono, no con el PAT.
//    [[norma-probar-el-camino-no-la-pieza]] · [[norma-un-candado-que-rompe-la-herramienta-es-peor]]
//
// Solo lectura: no escribe en ninguna tabla.
// Uso:  node pruebas/probar-turnos-rpc.mjs [JAC-B001] [2026-11-04]
// ═══════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAM = process.argv[2] || 'JAC-B001'
// Por defecto AYER: a primera hora del día de hoy todavía no hay checklist y la prueba
// daría vacío en todo, que es como se coló el verde falso la primera vez.
const _ay = new Date(Date.now() - 86400000)
const FECHA = process.argv[3] || _ay.toISOString().slice(0, 10)

// La URL y la llave salen de `chofer.html`: las MISMAS que usa el teléfono. Escribirlas acá
// a mano sería probar otra cosa. [[norma-dos-listas-a-mano-se-desincronizan]]
const html = fs.readFileSync(path.join(REPO, 'chofer.html'), 'utf8')
const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0]
const key = (html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0]
if (!url || !key) {
  console.error('⛔ no pude sacar la URL o la llave anon de chofer.html — ¿cambió el formato?')
  process.exit(1)
}
console.log(`base: ${url}  ·  llave anon: ${key.slice(0, 12)}…  ·  unidad ${CAM}  fecha ${FECHA}\n`)

const rpc = async (nombre, cuerpo) => {
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const t = await r.text()
  return { ok: r.ok, status: r.status, cuerpo: t.slice(0, 220) }
}

let fallos = 0
const probar = async (titulo, nombre, cuerpo, esperado) => {
  const r = await rpc(nombre, cuerpo)
  const bien = esperado(r)
  if (!bien) fallos++
  console.log(`${bien ? '✅' : '⛔'} ${titulo}`)
  console.log(`     HTTP ${r.status} · ${r.cuerpo.replace(/\s+/g, ' ').slice(0, 150)}`)
}

// ⛔ EXIGIR DATO, NO SOLO HTTP 200. La primera corrida de esta prueba dio las seis en verde
//    con TODAS las respuestas en `[]` —porque la fecha por defecto era hoy y aún no había
//    checklist—, así que la unidad real y una inventada se veían igual y el «control
//    positivo» no controlaba nada. Si la unidad real viene vacía, es que NO se midió.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
const conDato = (r) => r.ok && r.cuerpo.trim() !== '[]' && r.cuerpo.trim() !== ''
const vacio = (r) => r.ok && r.cuerpo.trim() === '[]'

// 1) EL CAMINO DE HOY: dos argumentos, tal cual lo llama la app desplegada.
await probar('la app de hoy (2 argumentos) sigue leyendo el checklist',
  'chofer_checklist_dia', { p_cam: CAM, p_fecha: FECHA }, conDato)
await probar('la app de hoy (2 argumentos) sigue leyendo los viajes',
  'chofer_viajes_dia', { p_cam: CAM, p_fecha: FECHA }, conDato)

// 2) EL CAMINO NUEVO: pidiendo un turno.
await probar('se puede pedir el turno DIURNO y trae lo mismo',
  'chofer_checklist_dia', { p_cam: CAM, p_fecha: FECHA, p_turno: 'diurno' }, conDato)
await probar('el turno NOCTURNO responde y viene vacío (todavía no existe)',
  'chofer_checklist_dia', { p_cam: CAM, p_fecha: FECHA, p_turno: 'nocturno' }, vacio)
await probar('los viajes de un turno se piden aparte',
  'chofer_viajes_dia', { p_cam: CAM, p_fecha: FECHA, p_turno: 'nocturno' }, vacio)

// 3) CONTROL POSITIVO: una unidad que NO existe tiene que ser RECHAZADA. Si todo diera
//    verde, incluso lo imposible, la prueba no estaría probando nada.
await probar('una unidad que no existe viene vacía — y la real NO, que es lo que lo hace valer',
  'chofer_checklist_dia', { p_cam: 'NO-EXISTE-999', p_fecha: FECHA }, vacio)

console.log(`\n${fallos ? '⛔ ' + fallos + ' comprobación(es) en rojo' : '✅ todas en verde'}`)
process.exit(fallos ? 1 : 0)
