// ══════════════════════════════════════════════════════════════════════════════
// CANDADO DE MARCA — pruebas
//
// La lista de palabras vive en `supabase/functions/procesar_cola_wassenger/index.ts`
// y se EXTRAE DEL ARCHIVO VIVO, no se copia acá. Una copia se desincroniza y esta
// prueba pasaría verde sobre un candado que en producción es otro.
//
// ⛔ LA MITAD QUE IMPORTA SON LOS FALSOS POSITIVOS. Un candado que traba texto
// legítimo se termina desactivando, y ahí se pierde entero. El 29/08/2026 un
// candado improvisado frenó un mensaje bueno por la palabra «botón» (buscaba `bot`
// como palabra suelta y la `ó` acentuada cuenta como separador), y la primera
// versión de esta lista perdió los `\b` al escribirse: sin ellos «IA» casa dentro
// de MARIA y FAMILIA.
//
//   node pruebas/candado-marca.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const RUTA = new URL('../supabase/functions/procesar_cola_wassenger/index.ts', import.meta.url);
const src = readFileSync(RUTA, 'utf8');

// ⛔ Antes que nada: que el archivo no traiga bytes de control. Los `\b` de las
// expresiones se pueden convertir en un backspace real (0x08) al escribirlos por un
// camino equivocado, y el resultado es INVISIBLE al leer el archivo. Pasó el 29/08.
if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src)) {
  console.error('FALLA: el archivo del worker contiene bytes de control invisibles.');
  console.error('       Casi seguro un `\\b` que quedó como backspace. Revisar MARCA_PROHIBIDA.');
  process.exit(1);
}

const bloque = src.match(/const MARCA_PROHIBIDA[\s\S]*?\n\];/);
if (!bloque) { console.error('FALLA: no se encontró MARCA_PROHIBIDA en el worker'); process.exit(1); }
const MARCA_PROHIBIDA = eval(bloque[0].replace('const MARCA_PROHIBIDA: Array<[string, RegExp]> =', '') + '');

function insinuaMaquina(txt) {
  const t = String(txt || '');
  for (const [etiqueta, re] of MARCA_PROHIBIDA) if (re.test(t)) return etiqueta;
  return null;
}

// ── Lo que TIENE que frenar ──────────────────────────────────────────────────
const DEBE_BLOQUEAR = [
  'Este resumen fue generado por inteligencia artificial',
  'Respuesta asistida por IA',
  'Soy un asistente virtual de la empresa',
  'Consultá con ChatGPT',
  'chat gpt lo resolvió',
  'Nuestro chatbot te atiende',
  'Procesado con Gemini',
  'Generado por Claude',
  'Usamos OpenAI para esto',
  'Anthropic',
  'Le respondió el copilot',
  'soy una inteligencia que aprende',
  'Informe generado por una máquina',
  'modelo de lenguaje entrenado',
];

// ── Lo que NO puede frenar: español de verdad, del que se manda todos los días ──
const DEBE_PASAR = [
  'Tocá ese botón y listo',                        // «bot|ón» — el falso positivo del 29/08
  'El robot de la planta está parado',
  'Se le rompió una bota al ayudante',
  'MARIA JOSE PEREZ no fichó hoy',                 // «IA» adentro de MARIA en mayúsculas
  'LA FAMILIA GONZALEZ debe dos cuotas',
  'Llamaron de la POLICIA por el accidente',
  'Aviso automático de vencimiento de documentos',  // «automático» es legítimo
  'La asistente de administración pasó el recibo',
  'Guia de despacho numero 4718',
  'El dia de hoy no hubo recoleccion en la zona',
  'Copia del comprobante adjunta',
  'Reporte diario de la flota: 10 unidades activas',
  'Surtieron 420,05 L en E/S LAS BANDERAS',
  'GPT no aparece por ningún lado acá',            // ⚠️ ésta SÍ debe bloquear: control invertido abajo
];
DEBE_PASAR.pop();   // la última era una trampa: se saca y se prueba como bloqueo
DEBE_BLOQUEAR.push('GPT no aparece por ningún lado acá');

let malos = 0;

for (const t of DEBE_BLOQUEAR) {
  const r = insinuaMaquina(t);
  if (!r) { console.error(`NO BLOQUEÓ (debía): ${JSON.stringify(t)}`); malos++; }
}
for (const t of DEBE_PASAR) {
  const r = insinuaMaquina(t);
  if (r) { console.error(`BLOQUEÓ DE MÁS por "${r}": ${JSON.stringify(t)}`); malos++; }
}

console.log(`bloqueos correctos: ${DEBE_BLOQUEAR.length} · textos legítimos que pasan: ${DEBE_PASAR.length}`);
if (malos) { console.error(`\nFALLA: ${malos} caso(s) mal.`); process.exit(1); }
console.log('OK — el candado frena lo que tiene que frenar y deja pasar el español normal.');
