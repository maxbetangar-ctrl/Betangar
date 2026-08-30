// ══════════════════════════════════════════════════════════════════════════════
// LO QUE SE LE DICE AL CHOFER AL GUARDAR UNA SURTIDA — pruebas
//
// 🔴 EL CASO QUE ORIGINÓ ESTO. Hasta el 30/08/2026, cuando el servidor RECHAZABA
// la surtida, `chofer.html` mostraba el error y **acto seguido lo pisaba** con un
// toast de éxito: «📵 Guardada (se sube al reconectar)». El chofer veía un
// mensaje de éxito, la surtida quedaba en el teléfono y nunca subía.
// Eso tuvo la carga de combustible rota TRES DÍAS (26 al 29/08) sin que nadie
// reportara nada — porque a nadie le aparece un problema cuando la pantalla dice
// «guardada». Un fallo disfrazado de éxito es peor que un error: no se reporta.
//
// Los tres desenlaces tienen que decir cosas DISTINTAS:
//   · guardó            → «registrada»
//   · no hubo señal     → «se sube sola al reconectar»  (esperar SÍ sirve)
//   · el servidor dijo que no → «NO quedó registrada … avisale a la oficina»
//                              (esperar NO sirve, y hay que decirlo)
//
// El texto se extrae DEL ARCHIVO VIVO: una copia acá se desincroniza y esta
// prueba pasaría verde sobre una pantalla que dice otra cosa.
//
//   node pruebas/surtida-mensaje-al-chofer.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../chofer.html', import.meta.url), 'utf8');

// ── 1. El desenlace del guardado: un solo mensaje por caso, y distintos ──────
const i = src.indexOf('var ok=false, rechazo=null;');
const j = src.indexOf('surCalc();', i);
if (i < 0 || j < 0) { console.error('FALLA: no se encontró el bloque del desenlace en chofer.html'); process.exit(1); }
const bloque = src.slice(i, j);

// ⚠️ Los mensajes son CONCATENACIONES (`'…'+rechazo+'…'`), así que se captura la
// llamada entera hasta el cierre y no solo el primer literal. La primera versión de
// esta prueba capturaba el primer trozo y daba un falso positivo: acusaba al código
// de no pedir avisar cuando sí lo pedía, dos líneas más adelante.
const casos = [
  ['guardó bien',            /if\(ok\)\{[\s\S]*?mostrarToast\(([\s\S]*?)\);/],
  ['el servidor rechazó',    /else if\(rechazo\)\{[\s\S]*?mostrarToast\(([\s\S]*?)\);/],
  ['sin señal',              /\}else\{[\s\S]*?mostrarToast\(([\s\S]*?)\);/],
];
const textos = {};
let malos = 0;
for (const [nombre, re] of casos) {
  const m = bloque.match(re);
  if (!m) { console.error(`FALLA: no hay mensaje para el caso «${nombre}»`); malos++; continue; }
  textos[nombre] = m[1];
}

// ⛔ Lo que NO puede pasar: que el rechazo del servidor diga lo mismo que la falta de señal.
if (textos['el servidor rechazó'] && textos['sin señal'] &&
    textos['el servidor rechazó'] === textos['sin señal']) {
  console.error('FALLA: el rechazo del servidor dice lo MISMO que la falta de señal. Ése es el bug.');
  malos++;
}
// El rechazo tiene que decir que NO quedó y pedir avisar: esperar no lo arregla.
const rech = textos['el servidor rechazó'] || '';
if (!/NO quedó registrada/i.test(rech)) { console.error('FALLA: el rechazo no dice que NO quedó registrada.'); malos++; }
if (!/avisa/i.test(rech))               { console.error('FALLA: el rechazo no pide avisar a nadie.'); malos++; }
// Y la falta de señal SÍ tiene que decir que se sube sola: ahí esperar sirve.
if (!/reconectar|se sube sola/i.test(textos['sin señal'] || '')) {
  console.error('FALLA: el caso sin señal no dice que se sube sola al reconectar.'); malos++;
}
// ⛔ Y el rechazo NO puede salir como 'exito' (era lo que lo hacía invisible).
if (!/else if\(rechazo\)\{[\s\S]*?,'error'\)/.test(bloque)) {
  console.error("FALLA: el rechazo del servidor no se muestra como 'error'."); malos++;
}

// ── 2. La cola no puede reintentar en silencio para siempre ─────────────────
const cola = src.slice(src.indexOf('async function subirColaSurtidas'), src.indexOf('function surSetTanque'));
if (!/_int\s*>=\s*3/.test(cola))            { console.error('FALLA: la cola no corta tras varios rechazos.'); malos++; }
if (!/NO es falta de señal/i.test(cola))    { console.error('FALLA: la cola no avisa que no es falta de señal.'); malos++; }
// ⛔ El contador es nuestro y no puede viajar a la base.
if (!/k!=='_int'/.test(cola))               { console.error('FALLA: el contador `_int` puede estar viajando a la RPC.'); malos++; }
// Sin red (catch) NO se gasta el contador: ahí reintentar sí sirve.
if (!/catch\(e\)\{ COLA_SUR\.push\(pend\[i\]\); \}/.test(cola)) {
  console.error('FALLA: el camino sin red debería reencolar sin gastar el contador.'); malos++;
}

console.log('mensajes leídos de chofer.html:');
for (const k of Object.keys(textos)) console.log(`  · ${k}: ${textos[k].slice(0, 78)}`);
if (malos) { console.error(`\nFALLA: ${malos} comprobación(es) mal.`); process.exit(1); }
console.log('\nOK — los tres desenlaces dicen cosas distintas, y la cola deja de insistir callada.');
