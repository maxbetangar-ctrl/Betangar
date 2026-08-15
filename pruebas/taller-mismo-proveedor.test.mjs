// ⛔ EL MISMO TALLER ESCRITO DE SIETE FORMAS ERAN SIETE TALLERES.
//
// (Replicado desde flotilla-app el 15/08/2026: MISMA pieza, MISMO defecto — arreglo en una es
//  arreglo en todas. En la base de Betangar el partido en dos es SERVICAR: 'SERVICAR AUTOLAVADO'
//  con 38 trabajos y $2.280 contra 'SERVICAR, C.A.' con 10 y $700. Máximo confirmó el 21/07 que
//  son el mismo. Acá se prueba que el sistema ya los reconoce; unir los registros viejos de
//  Betangar es aparte y lo decide él.)
//
// 15/08/2026. Carlos Serrano pidió comparar precios entre talleres: quién le vende el mismo
// repuesto más caro, quién le cobra la mano de obra más cara. Al medir la base de FLOTILLA para
// armar ese comparativo, esto era lo que había en `mantenimientos` (23 registros, 22 cargados por
// la hoja de vida, donde el taller era un campo de TEXTO LIBRE):
//
//     JAC concesionario         13   $905,48
//     JAc concesionario          3   $328,97
//     JAC Concesionario          2   $707,60
//     Jac concesionario          1    $64,62
//     JAC concecionario          1   $116,00     ← errata
//     Concesionario Jac          1   $590,25     ← orden de palabras
//     JAC concesinario           1    $50,00     ← errata
//     LA CASA DEL  CAMION C.A.   1   $150,00     ← doble espacio
//
// Son DOS talleres. El comparativo habría mostrado siete, y habría puesto al concesionario en $905
// cuando facturó $2.762,92 — el 95% del gasto de taller. Y ninguna de las siete formas coincide con
// su nombre real en `proveedores`: «AUTO UNION DC, C.A. (CONCESIONARIO JAC)».
//
// Los registros viejos los une la migración `mantenimientos_proveedor_id_2026-08-15.sql`, por lista
// explícita. Lo que prueba ESTE archivo es lo otro: que la puerta quedó cerrada HACIA ADELANTE. El
// desplegable nuevo de la hoja de vida permite «➕ Otro (escribir)» —tiene que permitirlo, un
// catálogo no puede trancar el registro de algo que ya pasó—, y lo único que impide que nazca un
// octavo «JAC concesinario» es que `_provBuscarParecido` lo reconozca y ofrezca el que ya existe.
//
// Se extraen las funciones del app.js REAL, no una copia.
// Verificada al revés: si se le quita a `_provBuscarParecido` la rama de erratas, se pone roja.
//
//   node pruebas/taller-mismo-proveedor.test.mjs
import { readFileSync } from 'fs'

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8')

function extraer(nombre) {
  const ini = src.indexOf('function ' + nombre + '(')
  if (ini < 0) throw new Error('no encontré function ' + nombre)
  return src.slice(ini, src.indexOf('\n}', ini) + 2)
}
function extraerVar(nombre) {
  const ini = src.indexOf('var ' + nombre + '=')
  if (ini < 0) throw new Error('no encontré var ' + nombre)
  return src.slice(ini, src.indexOf('];', ini) + 2)
}

const cuerpo = [
  extraer('_provNombreLimpio'),
  extraer('_provNorm'),
  extraerVar('_PROV_GENERICAS'),
  extraer('_provDist'),
  extraer('_provBuscarParecido'),
].join('\n')

// Los proveedores tal como están registrados hoy en FLOTILLA.
const PROVEEDORES = [
  { id: 'P1784660000001', nombre: 'AUTO UNION DC, C.A. (CONCESIONARIO JAC)' },
  { id: 'P1784646257072', nombre: 'LA CASA DEL CAMION C.A.' },
  { id: 'PSERVICAR', nombre: 'SERVICAR, C.A.' },
  { id: 'P1784057265049', nombre: 'NUMAN JAVIER MORALES QUINTERO' },
]

const { _provBuscarParecido } = new Function('ctx', `with(ctx){ ${cuerpo};
  return { _provBuscarParecido } }`)({ PROVEEDORES })

let fallas = 0, corridas = 0
function esperar(escrito, idEsperado, nota) {
  corridas++
  const hit = _provBuscarParecido(escrito)
  const got = hit ? hit.id : null
  if (got !== idEsperado) {
    fallas++
    console.log(`  ✗ "${escrito}" → ${hit ? hit.nombre : 'NINGUNO'}`)
    console.log(`      esperaba: ${idEsperado || 'NINGUNO'}   ${nota || ''}`)
  } else {
    console.log(`  ✓ "${escrito}" → ${hit ? hit.nombre : 'ninguno (correcto)'}`)
  }
}

const AUTOUNION = 'P1784660000001'
const CASACAMION = 'P1784646257072'

console.log('\nLas 7 formas del concesionario tienen que caer en AUTO UNION:')
esperar('JAC concesionario', AUTOUNION)
esperar('JAc concesionario', AUTOUNION, 'solo cambia una mayúscula')
esperar('JAC Concesionario', AUTOUNION, 'solo cambia una mayúscula')
esperar('Jac concesionario', AUTOUNION, 'solo cambia una mayúscula')
esperar('JAC concecionario', AUTOUNION, 'errata: concecionario')
esperar('Concesionario Jac', AUTOUNION, 'palabras al revés')
esperar('JAC concesinario', AUTOUNION, 'errata: concesinario')

console.log('\nEl otro taller, con el doble espacio con que se cargó:')
esperar('LA CASA DEL  CAMION C.A.', CASACAMION, 'doble espacio')
esperar('la casa del camion', CASACAMION, 'sin razón social ni mayúsculas')

console.log('\nEl taller que en Betangar está partido en dos:')
esperar('SERVICAR AUTOLAVADO', 'PSERVICAR', 'mismo taller, nombre comercial vs razón social')

console.log('\n⛔ Y lo que NO puede pasar: absorber a un taller que de verdad es OTRO.')
console.log('   Unir de más es peor que no unir: le carga la plata de uno a la cuenta de otro.')
esperar('TALLER HERMANOS RODRIGUEZ', null, 'no se parece a ninguno: debe quedar como nuevo')
esperar('CAUCHERA EL PROGRESO', null, 'no se parece a ninguno: debe quedar como nuevo')

console.log('')
if (fallas) {
  console.log(`❌ ${fallas} de ${corridas} fallaron`)
  process.exit(1)
}
console.log(`✅ ${corridas} comprobaciones OK`)
