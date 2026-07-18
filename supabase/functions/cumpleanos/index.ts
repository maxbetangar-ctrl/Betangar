// ════════════════════════════════════════════════════════════════════════════
// FlotaMax — CUMPLEAÑOS automáticos por WhatsApp (norma Maxware).
// Cron DIARIO. Felicita a cada empleado con fnac + whatsapp (o tel) que cumpla HOY.
// SIEMPRE ACTIVO por defecto; opt-out con configuracion clave 'cumples_auto' = off/{activo:false}.
// Idempotente por año (tabla cumple_log): no repite el saludo aunque corra varias veces.
// Solo ENCOLA en cola_mensajes; el worker procesar_cola_wassenger antepone la etiqueta de la
// empresa y envía (así el saludo sale firmado y se puede compartir número entre empresas).
// Fecha en America/Caracas (evita el corrimiento de día de UTC).
//   ?dry=1 → compone y devuelve la lista SIN encolar ni marcar (prueba; ignora el switch).
// Deploy por instancia (Betangar/FLOTILLA/demo). Usa SUPABASE_URL + SERVICE_ROLE_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true';

  // Switch opt-out (siempre activo salvo que la empresa lo apague). En dry se ignora para previsualizar.
  if (!dry) {
    const { data: swRow } = await sb.from('configuracion').select('valor').eq('clave', 'cumples_auto').maybeSingle();
    if (swRow?.valor !== undefined && swRow?.valor !== null) {
      let off = false;
      try {
        const v = typeof swRow.valor === 'string' ? swRow.valor.trim() : swRow.valor;
        if (typeof v === 'string') off = ['off', '0', 'false', 'no', 'inactivo'].includes(v.toLowerCase());
        else if (v && typeof v === 'object') off = v.activo === false;
      } catch { /* ignore */ }
      if (off) return json({ ok: true, desactivado: true, encolados: 0 });
    }
  }

  // Fecha HOY en Venezuela (America/Caracas). en-CA => 'YYYY-MM-DD'.
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const mmdd = s.slice(5, 10), anio = parseInt(s.slice(0, 4), 10);
  const bis = (anio % 4 === 0 && anio % 100 !== 0) || (anio % 400 === 0);
  const cumpleHoy = (fnac: string) => {
    const f = String(fnac || ''); if (f.length < 10) return false;
    const md = f.slice(5, 10);
    return md === mmdd || (md === '02-29' && !bis && mmdd === '02-28');
  };
  const primerNombre = (n: string) => String(n || '').trim().split(' ')[0] || '';
  const msgCumple = (n: string) =>
    `🎂 ¡Feliz cumpleaños, ${primerNombre(n)}! 🎉\n\nTe deseamos un día maravilloso, lleno de salud y bendiciones. ¡Gracias por tu dedicación y por ser parte del equipo! 💛`;

  // Empleados con fecha de nacimiento
  const { data: emps } = await sb.from('empleados').select('id,nombre,whatsapp,tel,fnac,activo').not('fnac', 'is', null);
  const hoy = (emps || []).filter((e: any) => e.activo !== false && cumpleHoy(e.fnac));
  const candidatos = hoy.map((e: any) => ({
    empleado_id: e.id, nombre: e.nombre,
    telefono: String(e.whatsapp || '').trim() || String(e.tel || '').trim(),
  })).filter((c: any) => c.telefono);

  if (dry) return json({ ok: true, dry: true, hoy: mmdd, candidatos: candidatos.map((c) => ({ nombre: c.nombre, telefono: c.telefono })) });
  if (!candidatos.length) return json({ ok: true, encolados: 0 });

  // Idempotencia: descartar a quien ya se felicitó este año
  const { data: yaLog } = await sb.from('cumple_log').select('empleado_id').eq('anio', anio);
  const yaSet = new Set((yaLog || []).map((l: any) => String(l.empleado_id)));
  const nuevos = candidatos.filter((c) => !yaSet.has(String(c.empleado_id)));
  if (!nuevos.length) return json({ ok: true, encolados: 0, yaFelicitados: candidatos.length });

  // (a) Saludo al festejado
  const filas: any[] = nuevos.map((c) => ({ telefono: c.telefono, mensaje: msgCumple(c.nombre), tipo: 'app', estado: 'pendiente' }));

  // (b) Aviso "¡Felicítalo!" a TODO el personal activo con teléfono (excepto el festejado). UNA sola vez:
  // esto corre solo para 'nuevos' (gated por cumple_log), así que no se repite en re-corridas ni por dispositivo.
  const { data: allEmps } = await sb.from('empleados').select('id,nombre,whatsapp,tel,activo');
  const personal = (allEmps || []).filter((e: any) => e.activo !== false && (String(e.whatsapp || '').trim() || String(e.tel || '').trim()));
  for (const c of nuevos) {
    const nom = primerNombre(c.nombre);
    for (const e of personal) {
      if (String(e.id) === String(c.empleado_id)) continue; // no al propio festejado
      const tel = String(e.whatsapp || '').trim() || String(e.tel || '').trim();
      filas.push({ telefono: tel, mensaje: `🎂 *Recordatorio de cumpleaños*\n\nHoy cumple años *${nom}*. Si lo ves hoy en el trabajo, aprovecha para felicitarlo/a en persona 🎉\n\nℹ️ Es un aviso automático de la empresa — *no respondas por aquí* (este número no es el de ${nom}).`, tipo: 'app', estado: 'pendiente' });
    }
  }

  const { error: errIns } = await sb.from('cola_mensajes').insert(filas);
  if (errIns) return json({ ok: false, error: errIns.message }, 500);

  // Marcar en el log (idempotencia)
  const logRows = nuevos.map((c) => ({ empleado_id: c.empleado_id, anio, telefono: c.telefono, nombre: c.nombre }));
  await sb.from('cumple_log').upsert(logRows, { onConflict: 'empleado_id,anio' });

  return json({ ok: true, encolados: filas.length });
});

function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
