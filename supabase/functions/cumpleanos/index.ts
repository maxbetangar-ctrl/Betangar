// BETANGAR — CUMPLEAÑOS por WhatsApp. Cron ~6am. Al festejado: TARJETA (imagen del arte cumple.html, render
// server-side vía microlink) directo por Wassenger. A todo el personal: recordatorio de texto (felicitar en
// persona, no responder aquí). UNA vez al año (idempotente por cumple_log).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
function normPhone(t: string) { let s = String(t || '').replace(/[^\d+]/g, ''); if (s.startsWith('+')) return s; if (s.startsWith('58')) return '+' + s; if (s.startsWith('0')) return '+58' + s.slice(1); if (s.length === 10) return '+58' + s; return '+' + s; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true';

  if (!dry) {
    const { data: swRow } = await sb.from('configuracion').select('valor').eq('clave', 'cumples_auto').maybeSingle();
    if (swRow?.valor !== undefined && swRow?.valor !== null) {
      let off = false;
      try { const v = typeof swRow.valor === 'string' ? swRow.valor.trim() : swRow.valor; if (typeof v === 'string') off = ['off', '0', 'false', 'no', 'inactivo'].includes(v.toLowerCase()); else if (v && typeof v === 'object') off = (v as any).activo === false; } catch { /* */ }
      if (off) return json({ ok: true, desactivado: true, encolados: 0 });
    }
  }

  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const mmdd = s.slice(5, 10), anio = parseInt(s.slice(0, 4), 10);
  const bis = (anio % 4 === 0 && anio % 100 !== 0) || (anio % 400 === 0);
  const cumpleHoy = (fnac: string) => { const f = String(fnac || ''); if (f.length < 10) return false; const md = f.slice(5, 10); return md === mmdd || (md === '02-29' && !bis && mmdd === '02-28'); };
  const primerNombre = (n: string) => String(n || '').trim().split(' ')[0] || '';
  const msgCumple = (n: string) => `🎂 ¡Feliz cumpleaños, ${primerNombre(n)}! 🎉\n\nTe deseamos un día maravilloso, lleno de salud y bendiciones. ¡Gracias por tu dedicación y por ser parte del equipo! 💛`;

  // URL de la tarjeta como IMAGEN (página cumple.html renderizada por microlink).
  const cardUrl = (c: any) => {
    const edad = String(c.fnac || '').length >= 4 ? (anio - parseInt(String(c.fnac).slice(0, 4), 10)) : '';
    const p = new URLSearchParams({ nombre: c.nombre || '', cargo: c.cargo || '', unidad: c.unidad || '', edad: edad ? String(edad) : '' });
    const cumple = 'https://betangar.com/cumple.html?' + p.toString();
    return 'https://api.microlink.io/?' + new URLSearchParams({ url: cumple, screenshot: 'true', embed: 'screenshot.url', fullPage: 'true', 'viewport.width': '600', type: 'png', waitUntil: 'networkidle0' }).toString();
  };

  const { data: emps } = await sb.from('empleados').select('id,nombre,whatsapp,tel,fnac,activo,cargo,unidad').not('fnac', 'is', null);
  const hoyE = (emps || []).filter((e: any) => e.activo !== false && cumpleHoy(e.fnac));
  const candidatos = hoyE.map((e: any) => ({ empleado_id: e.id, nombre: e.nombre, cargo: e.cargo, unidad: e.unidad, fnac: e.fnac, telefono: String(e.whatsapp || '').trim() || String(e.tel || '').trim() })).filter((c: any) => c.telefono);

  if (dry) return json({ ok: true, dry: true, hoy: mmdd, candidatos: candidatos.map((c: any) => ({ nombre: c.nombre, telefono: c.telefono, card: cardUrl(c) })) });
  if (!candidatos.length) return json({ ok: true, encolados: 0 });

  const { data: yaLog } = await sb.from('cumple_log').select('empleado_id').eq('anio', anio);
  const yaSet = new Set((yaLog || []).map((l: any) => String(l.empleado_id)));
  const nuevos = candidatos.filter((c: any) => !yaSet.has(String(c.empleado_id)));
  if (!nuevos.length) return json({ ok: true, encolados: 0, yaFelicitados: candidatos.length });

  const { data: wsRow } = await sb.from('configuracion').select('valor').eq('clave', 'wassenger').maybeSingle();
  let waToken = '';
  try { const w = typeof wsRow?.valor === 'string' ? JSON.parse(wsRow.valor) : wsRow?.valor; waToken = String(w?.token || '').trim(); } catch { /* */ }

  // (a) TARJETA al festejado (directo por Wassenger). Fallback a texto si no hay token o falla.
  const textFallback: any[] = [];
  let tarjetas = 0;
  for (const c of nuevos) {
    if (!waToken) { textFallback.push(c); continue; }
    try {
      const r = await fetch('https://api.wassenger.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Token': waToken },
        body: JSON.stringify({ phone: normPhone(c.telefono), message: `🎂 ¡Feliz cumpleaños, ${primerNombre(c.nombre)}! De parte de toda la familia Betangar 💛`, media: { url: cardUrl(c), filename: 'cumpleanos.png' } }),
      });
      if (r.ok || r.status === 201) tarjetas++; else textFallback.push(c);
    } catch { textFallback.push(c); }
  }

  // (b) Encolar: fallback de texto al festejado (si la tarjeta falló) + recordatorio a TODO el personal.
  const filas: any[] = textFallback.map((c: any) => ({ telefono: c.telefono, mensaje: msgCumple(c.nombre), tipo: 'app', estado: 'pendiente' }));
  const { data: allEmps } = await sb.from('empleados').select('id,nombre,whatsapp,tel,activo');
  const personal = (allEmps || []).filter((e: any) => e.activo !== false && (String(e.whatsapp || '').trim() || String(e.tel || '').trim()));
  for (const c of nuevos) {
    const nom = primerNombre(c.nombre);
    for (const e of personal) {
      if (String(e.id) === String(c.empleado_id)) continue;
      const tel = String(e.whatsapp || '').trim() || String(e.tel || '').trim();
      filas.push({ telefono: tel, mensaje: `🎂 *Recordatorio de cumpleaños*\n\nHoy cumple años *${nom}*. Si lo ves hoy en el trabajo, aprovecha para felicitarlo/a en persona 🎉\n\nℹ️ Es un aviso automático de la empresa — *no respondas por aquí* (este número no es el de ${nom}).`, tipo: 'app', estado: 'pendiente' });
    }
  }
  if (filas.length) { const { error: errIns } = await sb.from('cola_mensajes').insert(filas); if (errIns) return json({ ok: false, error: errIns.message }, 500); }

  const logRows = nuevos.map((c: any) => ({ empleado_id: c.empleado_id, anio, telefono: c.telefono, nombre: c.nombre }));
  await sb.from('cumple_log').upsert(logRows, { onConflict: 'empleado_id,anio' });

  return json({ ok: true, festejados: nuevos.length, tarjetas, encolados: filas.length });
});

function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
