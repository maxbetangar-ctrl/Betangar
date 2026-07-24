// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUPERVISOR AUTOMÁTICO DE COMBUSTIBLE — revisa lo cargado y avisa los errores a quien corresponde.
//
// Pedido de Máximo (2026-07-21): "un cron que si ve duplicados o algo mal introducido le avise a las
// personas involucradas, como el chofer y quien sea que esté por encima de él… algo que supervise y
// avise errores".
//
// A QUIÉN LE AVISA, y por qué así:
//   • Al CHOFER solo le llegan los ERRORES DE CARGA que él puede corregir (falta la medición, el km
//     quedó al revés, la altura no cuadra con la tabla). En tono de "revisá esto", nunca acusatorio.
//   • Las anomalías que podrían ser SUSTRACCIÓN (merma estacionada, consumo muy por encima) NO se le
//     mandan al chofer: van SOLO a mecánica/operativo/socios. Un WhatsApp automático no puede
//     insinuarle a una persona que se robó algo — puede ser perfectamente una regla mal leída.
//   • El resumen del día siempre va a los jefes.
//
// Idempotente por `alertas_log.alert_key`: cada aviso sale UNA vez aunque el cron corra de nuevo.
// Solo ENCOLA en cola_mensajes; el worker `procesar_cola_wassenger` lo envía con la marca de la
// empresa. Fecha en America/Caracas.  ?dry=1 → devuelve lo que mandaría, sin encolar ni marcar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const TOL_CAMION = 15;   // ±0,5 cm de lectura ≈ ±6,5 L; dos lecturas ≈ ±13 L → 15

// ⚠️ AVISO DE SUSTRACCIÓN EN PAUSA (2026-07-24, decisión de Máximo).
// La merma estacionada se seguía calculando, pero salía por WhatsApp con nombre y apellido apoyada
// en números que no aguantan. Auditoría del 24/07: de 13 alertas de julio, 7 eran camiones que SÍ
// rodaron entre las dos mediciones (hasta 208 km) — R1 afirmaba "un camión estacionado no consume"
// sin haber comprobado nunca el odómetro. Además la tabla de cubicación del camión es una recta
// (600 L ÷ 46 cm) y no una cubicación real, y `gasoil` no recibe un despacho desde el 07/07, así que
// el "sin despacho que lo explique" no significaba nada.
// Se sigue calculando y se sigue viendo en Combustible → Auditoría; lo que se calla es la ACUSACIÓN
// automática por WhatsApp. Se vuelve a encender cuando la cubicación esté buena. No borrar sin leer
// esto: apagarlo fue a propósito.
const AVISAR_SUSTRACCION = false;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  // Por defecto revisa AYER (el día ya cerrado). ?fecha=YYYY-MM-DD para revisar otro.
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const fecha = url.searchParams.get('fecha') || new Date(new Date(hoy + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const previo = new Date(new Date(fecha + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

  const [cfgT, med, gas, ck, emps, waCfg, logs] = await Promise.all([
    sb.from('combustible_tanques_config').select('*'),
    sb.from('combustible_mediciones').select('*').gte('fecha', previo).lte('fecha', fecha),
    sb.from('gasoil').select('*').gte('f', previo).lte('f', fecha),
    sb.from('checklist').select('fecha,cam,conductor,km_salida,km_entrada').gte('fecha', previo).lte('fecha', fecha),
    sb.from('empleados').select('nombre,whatsapp,tel,activo,cargo'),
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('alertas_log').select('alert_key').like('alert_key', 'comb_%'),
  ]);
  if (cfgT.error) return json({ ok: false, error: cfgT.error.message }, 500);

  const tanques = (cfgT.data || []).map((t: any) => {
    let tabla = t.tabla_cubicacion;
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla); } catch { tabla = null; } }
    return { id: t.id, tipo: t.tipo, hmax: num(t.altura_max_cm), tabla };
  });
  if (!tanques.length) return json({ ok: true, nota: 'esta empresa no usa cubicación — nada que auditar', avisos: 0 });

  const yaEnviado = new Set((logs.data || []).map((l: any) => l.alert_key));
  const marcar: string[] = [];
  const filas: any[] = [];

  // Teléfono del chofer por nombre (los checklists guardan el nombre, no el id).
  // El rango \u0300-\u036f son las tildes que suelta normalize('NFD'). Van escapadas a proposito:
  // escritas como caracteres sueltos se rompen al copiar el archivo entre herramientas.
  const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const telDe = (nombre: string): string => {
    const n = norm(nombre); if (!n) return '';
    const e = (emps.data || []).find((x: any) => x.activo !== false && norm(x.nombre) === n)
           || (emps.data || []).find((x: any) => x.activo !== false && norm(x.nombre).startsWith(n.split(' ')[0]) && n.split(' ').length > 1 && norm(x.nombre).includes(n.split(' ')[1]));
    return e ? String(e.whatsapp || e.tel || '').trim() : '';
  };
  // Jefes: del roster por rol. Mecánica y operativo son los que atienden esto; socios ve el resumen.
  let roster: any[] = [];
  try { roster = JSON.parse(String(waCfg.data?.valor || '[]')); } catch { roster = []; }
  const telsRol = (roles: string[]) => (Array.isArray(roster) ? roster : [])
    .filter((w: any) => w.num && w.activo !== false && roles.includes(w.rol))
    .map((w: any) => String(w.num));
  const jefes = [...new Set([...telsRol(['mecanica', 'operativo', 'socios'])])];

  // ── Cubicación: altura ➜ litros, interpolando (los tanques del galpón NO son lineales) ──
  const cubicar = (tq: any, cm: any): number | null => {
    const h = num(cm); if (h == null || !tq?.tabla) return null;
    const t = tq.tabla;
    if (t[String(h)] != null) return num(t[String(h)]);
    const ps = Object.keys(t).map(Number).filter((x) => !isNaN(x)).sort((a, b) => a - b);
    if (!ps.length) return null;
    if (h <= ps[0]) return num(t[String(ps[0])]);
    if (h >= ps[ps.length - 1]) return num(t[String(ps[ps.length - 1])]);
    for (let i = 1; i < ps.length; i++) {
      if (h <= ps[i]) {
        const h0 = ps[i - 1], h1 = ps[i], l0 = num(t[String(h0)])!, l1 = num(t[String(h1)])!;
        return Math.round((l0 + (h - h0) * (l1 - l0) / (h1 - h0)) * 100) / 100;
      }
    }
    return null;
  };
  const tqDe = (m: any) => tanques.find((x) => String(x.id) === String(m.tanque_id)) || tanques.find((x) => x.tipo === 'vehiculo') || tanques[0];

  // ── DUPLICADOS: misma unidad, fecha, momento y altura, cargado más de una vez ──
  const conteo: Record<string, any[]> = {};
  (med.data || []).filter((m: any) => String(m.fecha).slice(0, 10) === fecha).forEach((m: any) => {
    const k = [m.vehiculo_id, m.fecha, m.momento, m.altura_cm].join('|');
    (conteo[k] = conteo[k] || []).push(m);
  });
  const dupes = Object.keys(conteo).filter((k) => conteo[k].length > 1);
  const porUnidadDup: Record<string, number> = {};
  dupes.forEach((k) => {
    const m = conteo[k][0];
    porUnidadDup[String(m.vehiculo_id)] = (porUnidadDup[String(m.vehiculo_id)] || 0) + (conteo[k].length - 1);
  });

  // ── Revisión por unidad del día ──
  const delDia = (med.data || []).filter((m: any) => String(m.fecha).slice(0, 10) === fecha && tqDe(m)?.tipo !== 'galpon');
  const unidades = [...new Set(delDia.map((m: any) => String(m.vehiculo_id)).filter(Boolean))];
  const ckDia = (ck.data || []).filter((c: any) => String(c.fecha).slice(0, 10) === fecha);
  const errores: any[] = [];   // los que SÍ se le avisan al chofer
  const graves: any[] = [];    // solo a los jefes

  for (const u of unidades.concat(ckDia.map((c: any) => String(c.cam)).filter((x) => !unidades.includes(x)))) {
    const ms = delDia.filter((m: any) => String(m.vehiculo_id) === u);
    const sal = ms.find((m: any) => String(m.momento) === 'salida');
    const lle = ms.find((m: any) => String(m.momento) === 'llegada');
    const c = ckDia.find((x: any) => String(x.cam) === u);
    const chofer = String(c?.conductor || sal?.registrado_por || lle?.registrado_por || '').trim();
    const kmS = num(c?.km_salida), kmE = num(c?.km_entrada);
    const trabajo = kmS != null && kmE != null && kmE > kmS;

    if (porUnidadDup[u]) errores.push({ u, chofer, tipo: 'duplicado', txt: `la medición del tanque quedó cargada ${porUnidadDup[u] + 1} veces` });
    if (trabajo && !sal) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la SALIDA' });
    if (trabajo && !lle) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la LLEGADA' });
    if (kmS != null && kmE != null && kmE < kmS) errores.push({ u, chofer, tipo: 'km', txt: `el kilometraje de llegada (${fmt(kmE)}) es menor que el de salida (${fmt(kmS)})` });

    for (const m of ms) {
      const tq = tqDe(m), cm = num(m.altura_cm), calc = cubicar(tq, cm), rec = num(m.litros_calculados);
      if (cm != null && tq?.hmax && (cm < 0 || cm > tq.hmax)) {
        errores.push({ u, chofer: String(m.registrado_por || chofer), tipo: 'altura', txt: `la medición de ${m.momento} dice ${fmt(cm)} cm y ese tanque llega hasta ${fmt(tq.hmax)} cm` });
      } else if (calc != null && rec != null && Math.abs(rec - calc) > 2) {
        errores.push({ u, chofer: String(m.registrado_por || chofer), tipo: 'tabla', txt: `en la medición de ${m.momento} (${fmt(cm)} cm) los litros guardados (${fmt(rec)}) no coinciden con la tabla (${fmt(calc)})` });
      }
    }

    // Merma estacionada: comparar la salida de hoy con la llegada de ayer. Esto NO va al chofer.
    const lleAyer = (med.data || []).find((m: any) => String(m.vehiculo_id) === u && String(m.fecha).slice(0, 10) === previo && String(m.momento) === 'llegada');
    if (sal && lleAyer) {
      const a = cubicar(tqDe(sal), sal.altura_cm), b = cubicar(tqDe(lleAyer), lleAyer.altura_cm);
      const desp = (gas.data || []).filter((gg: any) => String(gg.cam) === u && String(gg.f).slice(0, 10) === fecha && String(gg.tipo_operacion || '') !== 'compra')
        .reduce((s: number, gg: any) => s + (num(gg.lit) || 0), 0);
      if (a != null && b != null) {
        const d = Math.round((a - b - desp) * 100) / 100;
        if (d < -TOL_CAMION) graves.push({ u, chofer, litros: d, txt: `salió con ${fmt(Math.abs(d))} L menos de los que dejó al llegar el día anterior, sin despacho que lo explique` });
      }
    }
  }

  // ── Mensajes al CHOFER (solo errores de carga, agrupados por persona) ──
  const porChofer: Record<string, any[]> = {};
  errores.forEach((e) => { if (e.chofer) (porChofer[e.chofer] = porChofer[e.chofer] || []).push(e); });
  for (const ch of Object.keys(porChofer)) {
    const tel = telDe(ch);
    const key = `comb_chofer_${fecha}_${norm(ch).replace(/ /g, '_')}`;
    if (yaEnviado.has(key)) continue;
    if (!tel) continue;   // sin teléfono no se puede avisar (se informa en el resumen a los jefes)
    const lista = porChofer[ch].map((e) => `• ${e.u}: ${e.txt}`).join('\n');
    const msg = `Hola ${primerNombre(ch)}, revisá por favor lo del ${fmtFecha(fecha)}:\n\n${lista}\n\n` +
      `No es un reclamo: son datos que quedaron incompletos o raros y sin ellos no se puede cuadrar el combustible del día. ` +
      `Si podés corregirlo en el sistema, mejor; si no, avisale al encargado para que lo ajuste. Gracias.`;
    filas.push({ telefono: tel, mensaje: msg, tipo: 'auditoria' });
    marcar.push(key);
  }

  // ── Resumen a los JEFES (errores + lo grave, y a quién no se le pudo avisar) ──
  const keyJefes = `comb_jefes_${fecha}`;
  const gravesAvisables = AVISAR_SUSTRACCION ? graves : [];
  if (!yaEnviado.has(keyJefes) && (errores.length || gravesAvisables.length)) {
    let msg = `🔎 Revisión del combustible — ${fmtFecha(fecha)}\n`;
    if (gravesAvisables.length) {
      msg += `\n🔴 PARA REVISAR (${gravesAvisables.length}):\n` + gravesAvisables.map((x) => `• ${x.u}${x.chofer ? ` (${primerNombre(x.chofer)})` : ''}: ${x.txt}`).join('\n') + '\n';
    }
    if (errores.length) {
      const sinTel = [...new Set(errores.filter((e) => e.chofer && !telDe(e.chofer)).map((e) => primerNombre(e.chofer)))];
      msg += `\n🟡 Datos por corregir (${errores.length}):\n` + errores.slice(0, 12).map((e) => `• ${e.u}: ${e.txt}`).join('\n');
      if (errores.length > 12) msg += `\n…y ${errores.length - 12} más.`;
      msg += `\n\nA cada chofer se le avisó lo suyo.`;
      if (sinTel.length) msg += ` Sin teléfono cargado (no se les pudo avisar): ${sinTel.join(', ')}.`;
    }
    // Si hay posible merma pero el aviso está en pausa, no se esconde: se dice que existe y dónde
    // mirarla, sin nombrar a nadie. Callar la acusación no es callar el dato.
    if (!AVISAR_SUSTRACCION && graves.length) {
      msg += `\n\nℹ️ Quedaron ${graves.length} caso(s) de combustible sin cuadrar. No se detallan acá ni se le atribuyen a nadie: la medición del tanque se está recalibrando y los litros todavía no aguantan para señalar a una persona. Están en Combustible → Auditoría.`;
    }
    msg += `\n\nEl detalle completo está en Combustible → Auditoría.`;
    jefes.forEach((t) => filas.push({ telefono: t, mensaje: msg, tipo: 'auditoria' }));
    marcar.push(keyJefes);
  }

  if (dry) return json({ ok: true, dry: true, fecha, duplicados: dupes.length, errores: errores.length, graves: graves.length, encolaria: filas.length, muestra: filas.slice(0, 3) });
  if (!filas.length) return json({ ok: true, fecha, avisos: 0, nota: 'nada que avisar' });

  const ins = await sb.from('cola_mensajes').insert(filas);
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  if (marcar.length) await sb.from('alertas_log').insert([...new Set(marcar)].map((k) => ({ alert_key: k })));
  return json({ ok: true, fecha, avisos: filas.length, errores: errores.length, graves: graves.length, duplicados: dupes.length });
});

function num(v: any): number | null { const n = parseFloat(v); return isFinite(n) ? n : null; }
function fmt(n: any): string { return Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }); }
function fmtFecha(f: string): string { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
function primerNombre(n: string): string {
  const t = String(n || '').trim().split(/[ ,]+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
