// ════════════════════════════════════════════════════════════════════════════════════════════════
// BETANGAR — KILÓMETROS QUE NINGÚN VIAJE EXPLICA (semanal)
//
// De dónde sale: el 2026-07-25, mostrándole a Máximo cómo se leen los hallazgos de la auditoría de
// combustible, él señaló algo que estaba mal ubicado: la regla "rodó sin jornada registrada" (R11)
// vivía dentro del módulo de COMBUSTIBLE, pero no es un hallazgo del tanque — es de OPERACIÓN. Su
// consecuencia es facturación a la Alcaldía y nómina, no litros. El que abre Combustible no es el
// que factura viajes, así que el hallazgo le llegaba a quien no podía hacer nada con él.
//
// LA PREGUNTA QUE HACE: no "¿rodó sin checklist?" sino "¿estos kilómetros tienen un viaje que los
// explique?". Esa es la que vale plata.
//
// ⚠️ NO ACUSA. Máximo confirmó que un camión rodando sin viaje es "casi nulo, pero puede pasar"
// (ir a surtir, un traslado al taller, mover la unidad). Por eso el texto PREGUNTA y nombra los
// motivos posibles. Los datos dicen QUÉ pasó; solo una persona sabe POR QUÉ.
//
// ── LAS CUATRO PRECONDICIONES (cada una se probó contra los datos reales antes de escribirla) ────
// Sin ellas esto era una máquina de acusar. Los tres intentos que fallaron el 25/07:
//
//  1. UN DÍA NO SE EVALÚA HASTA QUE SU PLANILLA ESTÉ CARGADA.
//     Las planillas se cargan VARIOS DÍAS DESPUÉS (regla de Máximo). El primer cruce dio 3.926 km
//     "sin planilla"… y todos caían el 22, 23, 24 y 25 de julio, días sin NINGUNA planilla cargada
//     de NINGUNA unidad. No era un hallazgo: era el ritmo normal de la operación.
//     Por eso esta función mira 14 DÍAS HACIA ATRÁS y marca cada día UNA vez, cuando su planilla
//     aparece. Que carguen tarde deja de importar.
//
//  2. LOS VIAJES DEL DÍA SON LA SUMA DE TODOS LOS TURNOS.
//     Un camión tiene planillas separadas de turno DIURNO (d) y NOCTURNO (n), con número de planilla
//     y ruta distintos. Contadas como filas sueltas parecían 54 "viajes duplicados" entre abril y
//     julio. No lo eran: es trabajo real, bien cargado. Se suma `t` de todas las planillas del día.
//
//  3. EL SALTO DE ODÓMETRO SOLO CUENTA SI EL CHECKLIST ANTERIOR ES DEL DÍA ANTERIOR.
//     Tomando el checklist anterior aunque fuera de hace tres días, los km de los días sin checklist
//     se le cargaban al siguiente y aparecían saltos de 404 km que nunca existieron.
//
//  4. LA REFERENCIA ES LA MEDIANA DE CADA UNIDAD, NO UN NÚMERO FIJO.
//     Medido sobre junio-julio: los camiones van de 51 a 72 km por viaje. Un día legítimo cargado
//     llega a 1,9× su propia mediana (B007, el más parejo, va de 47 a 88). Por eso el umbral es
//     2× Y un exceso de más de 60 km: por debajo de eso es la variación normal del trabajo.
//
// Con las cuatro, julio entero deja UN hallazgo (B009 el 18/07). Sin ellas daban quince.
// Ver [[norma-auditoria-precondicion-antes-de-acusar]].
//
// Idempotente por `alertas_log.alert_key` = kmviaje_<cam>_<fecha>: cada día se pregunta una sola vez
// aunque la función corra todas las semanas. Solo ENCOLA en cola_mensajes.
//   ?dry=1     → devuelve lo que mandaría, sin encolar ni marcar.
//   ?desde= &hasta=  → fuerza una ventana (por defecto, los últimos 14 días hasta ayer).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

const DIAS_VENTANA = 14;      // cuánto se mira hacia atrás esperando que carguen las planillas
const DIAS_HISTORIA = 120;    // de dónde sale la mediana de km por viaje de cada unidad
const MIN_DIAS_REF = 8;       // sin esta historia, de esa unidad no se opina
const VECES_LO_NORMAL = 2;    // un día legítimo cargado llega a 1,9× su propia mediana
const EXCESO_MINIMO = 60;     // y además tienen que sobrar más de 60 km
// 5ª precondición: un día físicamente imposible es un DEDAZO, no un viaje sin registrar. La flota
// hace 60-130 km/día; el mismo criterio que ya usa `km-anomalias` para avisarle al chofer. Sin esto,
// el 01/07 B007 salía con 10.246 km: el 30/06 alguien tecleó "10" de odómetro en vez de 10.1xx y el
// salto contra ese 10 fabricó 9.982 km fantasma. Preguntar por eso sería ridículo y quemaría el
// módulo entero. Se saltea y se cuenta a la vista — el dedazo lo reclama km-anomalias.
const MAX_KM_DIA = 400;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';

  const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const menos = (n: number, base: string) => new Date(new Date(base + 'T12:00:00Z').getTime() - n * 86400000).toISOString().slice(0, 10);
  const HASTA = url.searchParams.get('hasta') || menos(1, hoyVE);
  const DESDE = url.searchParams.get('desde') || menos(DIAS_VENTANA, HASTA);
  const HIST = menos(DIAS_HISTORIA, HASTA);

  // ⚠️ PAGINADO A PROPÓSITO. Supabase corta en 1000 filas EN SILENCIO — no da error, devuelve menos.
  // Acá costó un falso "todo limpio": 120 días de `planillas` son 1.079 filas, se leyeron las
  // primeras 1000 y las que quedaron afuera eran las de julio. El 18/07 de B009 (el único hallazgo
  // real del mes) apareció como "falta la planilla" en vez de revisarse. Un módulo que se queda
  // callado porque no leyó todo es peor que uno que no existe: da tranquilidad falsa.
  const leerTodo = async (tabla: string, cols: string, col: string) => {
    const PAG = 1000; let out: any[] = []; let i = 0;
    for (;;) {
      const r = await sb.from(tabla).select(cols).gte(col, HIST).lte(col, HASTA).order('id').range(i, i + PAG - 1);
      if (r.error) throw new Error(tabla + ': ' + r.error.message);
      const filas = r.data || [];
      out = out.concat(filas);
      if (filas.length < PAG) return out;
      i += PAG;
      if (i > 100000) return out;                    // tope de seguridad, nunca debería llegar
    }
  };
  let ckData: any[], plData: any[];
  try {
    ckData = await leerTodo('checklist', 'fecha,cam,conductor,km_salida,km_entrada', 'fecha');
    plData = await leerTodo('planillas', 'f,cam,t,d,n,ch', 'f');
  } catch (e) { return json({ ok: false, error: String(e) }, 500); }
  const [waCfg, logs] = await Promise.all([
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('alertas_log').select('alert_key').like('alert_key', 'kmviaje_%'),
  ]);
  const ck = { data: ckData }, pl = { data: plData };

  // ── Viajes por unidad y día: SUMA de todos los turnos (precondición 2) ────────────────────────
  const viajesDe: Record<string, number> = {};
  const turnosDe: Record<string, number> = {};
  (pl.data || []).forEach((p: any) => {
    const k = String(p.cam) + '|' + String(p.f).slice(0, 10);
    viajesDe[k] = (viajesDe[k] || 0) + (num(p.t) || 0);
    turnosDe[k] = (turnosDe[k] || 0) + 1;
  });

  // ── Km de cada día por unidad, con el salto de odómetro SOLO si el checklist anterior es de
  //    ayer (precondición 3) ────────────────────────────────────────────────────────────────────
  const porCam: Record<string, any[]> = {};
  (ck.data || []).forEach((c: any) => {
    const cam = String(c.cam || ''); if (!cam) return;
    (porCam[cam] = porCam[cam] || []).push({ f: String(c.fecha).slice(0, 10), ks: km(c.km_salida), ke: km(c.km_entrada), ch: c.conductor || '' });
  });
  const dias: any[] = [];
  Object.keys(porCam).forEach((cam) => {
    const lista = porCam[cam].sort((a, b) => a.f.localeCompare(b.f));
    lista.forEach((d, i) => {
      if (d.ks == null || d.ke == null || d.ke <= d.ks) return;   // sin jornada medible, no se opina
      let entre = 0;
      const ant = i > 0 ? lista[i - 1] : null;
      if (ant && ant.ke != null && esDiaSiguiente(ant.f, d.f)) entre = Math.max(0, d.ks - ant.ke);
      dias.push({ cam, f: d.f, chofer: d.ch, kmDia: d.ke - d.ks, entre, km: (d.ke - d.ks) + entre, kmAnt: ant?.ke ?? null, fAnt: ant?.f ?? null });
    });
  });

  // ── Referencia: la MEDIANA de km por viaje DE CADA UNIDAD (precondición 4) ────────────────────
  const ratios: Record<string, number[]> = {};
  dias.forEach((d) => {
    const v = viajesDe[d.cam + '|' + d.f];
    if (!v) return;                                   // día sin planilla: no entra ni a la referencia
    (ratios[d.cam] = ratios[d.cam] || []).push(d.km / v);
  });
  const refDe: Record<string, number | null> = {};
  Object.keys(ratios).forEach((cam) => {
    const xs = ratios[cam].slice().sort((a, b) => a - b);
    refDe[cam] = xs.length >= MIN_DIAS_REF ? mediana(xs) : null;
  });

  // ── La revisión, solo sobre la ventana ────────────────────────────────────────────────────────
  const yaPreguntado = new Set((logs.data || []).map((l: any) => l.alert_key));
  const hallazgos: any[] = [];
  const pendientes: Record<string, number> = {};      // días con km pero sin planilla todavía
  const imposibles: any[] = [];                       // días con un km que no puede ser: dedazo
  const marcar: string[] = [];

  dias.filter((d) => d.f >= DESDE && d.f <= HASTA).forEach((d) => {
    const k = d.cam + '|' + d.f;
    const v = viajesDe[k];
    if (!v) {                                          // precondición 1: todavía no se puede juzgar
      pendientes[d.f] = (pendientes[d.f] || 0) + 1;
      return;
    }
    if (d.km > MAX_KM_DIA) {                           // precondición 5: es un dedazo, no un viaje
      imposibles.push({ cam: d.cam, fecha: d.f, km: d.km });
      return;
    }
    const ref = refDe[d.cam];
    if (ref == null || !(ref > 0)) return;              // sin historia propia, de esa unidad no se opina
    const esperado = v * ref;
    const exceso = Math.round(d.km - esperado);
    if (!(d.km / v > VECES_LO_NORMAL * ref)) return;
    if (!(exceso > EXCESO_MINIMO)) return;
    const key = `kmviaje_${d.cam}_${d.f}`;
    if (yaPreguntado.has(key)) return;                 // este día ya se preguntó una vez
    hallazgos.push({ ...d, viajes: v, turnos: turnosDe[k] || 1, ref: Math.round(ref * 10) / 10, esperado: Math.round(esperado), exceso, key });
    marcar.push(key);
  });

  // ── El mensaje: pregunta, no acusa ───────────────────────────────────────────────────────────
  let roster: any[] = [];
  try { roster = JSON.parse(String(waCfg.data?.valor || '[]')); } catch { roster = []; }
  const telsRol = (roles: string[]) => (Array.isArray(roster) ? roster : [])
    .filter((w: any) => w.num && w.activo !== false && roles.includes(w.rol)).map((w: any) => String(w.num));
  const destinos = [...new Set(telsRol(['operativo', 'socios']))];

  const filas: any[] = [];
  if (hallazgos.length) {
    const lineas = hallazgos.map((h) => {
      const deNoche = h.entre > 0
        ? ` De esos, ${fmt(h.entre)} km aparecieron entre que llegó el ${fmtF(h.fAnt)} (${fmt(h.kmAnt)} km) y salió el ${fmtF(h.f)}, o sea fuera de toda jornada.`
        : '';
      return `• ${h.cam} — ${fmtF(h.f)}\n` +
        `  Rodó ${fmt(h.km)} km y las planillas de ese día son ${h.viajes} viaje(s)${h.turnos > 1 ? ` (${h.turnos} turnos)` : ''}. ` +
        `Esta unidad hace ${fmt(h.ref)} km por viaje, así que los viajes explican ${fmt(h.esperado)}: sobran ${fmt(h.exceso)} km.${deNoche}`;
    }).join('\n\n');
    const msg = `🚛 Kilómetros que ningún viaje explica — ${fmtF(DESDE)} al ${fmtF(HASTA)}\n\n` +
      `${lineas}\n\n` +
      `Puede haber un motivo normal: que la unidad fuera a surtir, un traslado al taller o al concesionario, ` +
      `o que faltara cargar un viaje en la planilla. Lo que hace falta es preguntarle al supervisor de esa unidad ` +
      `qué hizo ese día. No es un señalamiento: son kilómetros que hoy no están respaldados por ningún viaje, ` +
      `y mientras no se aclare tampoco se están facturando.`;
    destinos.forEach((t) => filas.push({ telefono: t, mensaje: msg, tipo: 'auditoria' }));
  }

  // Los días que todavía no se pueden juzgar NO son un hallazgo, pero sí se informan: que falten
  // planillas por cargar es en sí mismo algo que alguien tiene que resolver, y explica por qué
  // este reporte no habla de esos días.
  const diasPend = Object.keys(pendientes).sort();
  if (diasPend.length && destinos.length) {
    const msgP = `🗓️ Faltan planillas por cargar\n\n` +
      diasPend.map((f) => `• ${fmtF(f)}: ${pendientes[f]} unidad(es) con kilómetros registrados y sin planilla`).join('\n') +
      `\n\nEsos días no se revisaron: sin la planilla no se puede saber si los kilómetros tienen viaje que los explique. ` +
      `Se vuelven a mirar solos en cuanto se carguen.`;
    const keyP = `kmviaje_pendientes_${HASTA}`;
    if (!yaPreguntado.has(keyP)) {
      destinos.forEach((t) => filas.push({ telefono: t, mensaje: msgP, tipo: 'auditoria' }));
      marcar.push(keyP);
    }
  }

  // `filas_leidas` sale siempre: si algún día vuelve a aparecer un tope redondo (1000, 2000) es la
  // señal de que la paginación se rompió. Un número a la vista es más barato que otro falso "limpio".
  const resumen = { ventana: [DESDE, HASTA], filas_leidas: { checklist: ckData.length, planillas: plData.length },
                    unidades_con_referencia: Object.values(refDe).filter((x) => x != null).length,
                    dias_revisados: dias.filter((d) => d.f >= DESDE && d.f <= HASTA && viajesDe[d.cam + '|' + d.f]).length,
                    dias_pendientes_de_planilla: Object.values(pendientes).reduce((a, b) => a + b, 0),
                    dias_con_km_imposible: imposibles,
                    hallazgos: hallazgos.length, detalle: hallazgos.map((h) => ({ cam: h.cam, fecha: h.f, km: h.km, viajes: h.viajes, exceso: h.exceso })) };
  if (dry) return json({ ok: true, dry: true, ...resumen, encolaria: filas.length, muestra: filas.slice(0, 1) });
  if (!filas.length) return json({ ok: true, ...resumen, avisos: 0, nota: 'nada que preguntar' });

  const ins = await sb.from('cola_mensajes').insert(filas);
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  if (marcar.length) await sb.from('alertas_log').insert([...new Set(marcar)].map((k) => ({ alert_key: k })));
  return json({ ok: true, ...resumen, avisos: filas.length });
});

function num(v: any): number | null { const n = parseFloat(v); return isFinite(n) ? n : null; }
// Un 0 en el odómetro NO es un odómetro en cero: es el checklist sin cerrar o sin dato.
function km(v: any): number | null { const n = num(v); return (n != null && n > 0) ? n : null; }
function mediana(xs: number[]): number { const n = xs.length; return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2; }
function esDiaSiguiente(a: string, b: string): boolean {
  const d = new Date(a + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) === b;
}
function fmt(n: any): string { return (n == null) ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }); }
function fmtF(f: string): string { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
