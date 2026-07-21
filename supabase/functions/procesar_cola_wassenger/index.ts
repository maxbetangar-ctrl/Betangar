// ════════════════════════════════════════════════════════════════════════════
// FlotaMax — Worker de mensajería por WASSENGER (procesa la cola cola_mensajes).
//
// DISEÑO PLUG-AND-PLAY: la credencial Wassenger NO va en el código — se guarda en
// la tabla `configuracion` (clave='wassenger', valor={token, device, activo}) desde
// la UI del cliente (Configuración → Wassenger). Cuando el cliente crea su cuenta,
// pega su Token + device en la app y esto empieza a enviar. Cero redeploy.
//
// Deploy (una vez por cliente): supabase functions deploy procesar_cola_wassenger
// Cron: llamar esta función cada ~2-5 min (pg_cron o Scheduler) para vaciar la cola.
//
// Usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env estándar de Supabase).
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) credencial Wassenger del cliente (desde la config, no del código)
  const { data: cfgRow } = await sb.from('configuracion').select('valor').eq('clave', 'wassenger').maybeSingle();
  let cfg: any = {};
  try { cfg = cfgRow?.valor ? (typeof cfgRow.valor === 'string' ? JSON.parse(cfgRow.valor) : cfgRow.valor) : {}; } catch { cfg = {}; }
  if (!cfg.token || cfg.activo === false) {
    return json({ ok: true, nota: 'Wassenger no configurado o desactivado — nada que enviar', sent: 0 });
  }

  // Etiqueta de la empresa: se antepone a CADA mensaje para poder COMPARTIR un mismo número entre empresas
  // (FLOTILLA / Betangar / MaxCredit) sin que quien recibe se confunda (clave anti-spam con conocidos).
  // Config-driven: cfg.etiqueta (en configuracion.wassenger) o, si falta, el nombre de la empresa.
  let etiqueta = (cfg.etiqueta || '').trim();
  if (!etiqueta) {
    const { data: empRow } = await sb.from('configuracion').select('valor').eq('clave', 'empresa').maybeSingle();
    try { const emp = empRow?.valor ? (typeof empRow.valor === 'string' ? JSON.parse(empRow.valor) : empRow.valor) : {}; etiqueta = (emp?.nombre || '').trim(); } catch { /* sin etiqueta */ }
  }
  const conEtiqueta = (msg: string) => (etiqueta && !msg.startsWith(etiqueta)) ? `${etiqueta}: ${msg}` : msg;

  // 0) CADUCAR lo viejo ANTES de enviar nada. Va primero a propósito: si la cola venía represada,
  //    esto evita el aluvión de mensajes de ayer en cuanto el servicio vuelve.
  //    Norma de Máximo (2026-07-21): "lo que se haya pasado de ayer ya no lo envíes hoy". Un aviso
  //    operativo es de SU día: al día siguiente confunde a quien lo recibe, que ya actuó o ya no
  //    puede actuar. Se DESCARTAN (no se borran) dejando el motivo escrito.
  const VIGENCIA_HORAS = 12;
  const corte = new Date(Date.now() - VIGENCIA_HORAS * 60 * 60 * 1000).toISOString();
  const { data: caducados } = await sb.from('cola_mensajes')
    .update({ estado: 'descartado', error: `caducado: encolado hace mas de ${VIGENCIA_HORAS}h; un aviso operativo es de su dia y no se reenvia despues` })
    .eq('estado', 'pendiente').lt('created_at', corte).select('id');

  // 1) Recupera mensajes trabados en 'enviando' por una corrida que murió a mitad (>10 min). enviado_at
  //    hace de marca de reclamo; si quedó viejo, la fila vuelve a 'pendiente' para reintentar.
  const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('cola_mensajes').update({ estado: 'pendiente' }).eq('estado', 'enviando').lt('enviado_at', staleTs);

  // 2) mensajes pendientes (tanda)
  const { data: pend } = await sb.from('cola_mensajes').select('*').eq('estado', 'pendiente').lt('intentos', 4).order('id').limit(25);
  if (!pend || !pend.length) return json({ ok: true, sent: 0, caducados: caducados?.length || 0 });

  let sent = 0, fail = 0;
  for (const m of pend) {
    // CLAIM atómico: marca la fila 'enviando' SOLO si sigue 'pendiente'. Si dos corridas del cron se
    // solapan, únicamente una gana el claim; la otra ve 0 filas y salta → sin doble envío.
    const { data: claim } = await sb.from('cola_mensajes')
      .update({ estado: 'enviando', enviado_at: new Date().toISOString() })
      .eq('id', m.id).eq('estado', 'pendiente').select('id').maybeSingle();
    if (!claim) continue; // otra corrida ya lo tomó
    try {
      const phone = normalizar(m.telefono);
      const body: any = { phone, message: conEtiqueta(m.mensaje) };
      if (cfg.device) body.device = cfg.device;
      const r = await fetch('https://api.wassenger.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Token': cfg.token }, body: JSON.stringify(body),
      });
      if (r.ok || r.status === 201) {
        // error:null — al salir bien se BORRA el error del intento fallido anterior. Si no, un
        // mensaje que se reintentó y llegó queda "enviado" pero mostrando un error viejo, y quien
        // lo mire va a creer que no salió (pasó el 2026-07-20 con un 502: llegó en el reintento
        // pero el registro parecía fallido).
        await sb.from('cola_mensajes').update({ estado: 'enviado', enviado_at: new Date().toISOString(), error: null }).eq('id', m.id);
        sent++;
      } else {
        const t = await r.text();
        // 429 = cuota del plan agotada. NO gastar intentos: si se queman los 4, el mensaje muere
        // como 'fallido' aunque el problema sea de cuota y no del mensaje. Pasó el 2026-07-20 con
        // el trial agotado: se perdieron 6 avisos reales (resúmenes del día y recordatorios). Se
        // deja 'pendiente' SIN incrementar el intento y se corta la tanda: seguir no tiene sentido.
        const esCuota = r.status === 429;
        await sb.from('cola_mensajes').update({
          intentos: esCuota ? (m.intentos || 0) : (m.intentos || 0) + 1,
          error: t.slice(0, 300),
          estado: (!esCuota && (m.intentos || 0) + 1 >= 4) ? 'fallido' : 'pendiente',
        }).eq('id', m.id);
        fail++;
        if (esCuota) return json({ ok: false, sent, fail, caducados: caducados?.length || 0, nota: 'cuota Wassenger agotada (429) — la cola queda intacta, no se gastaron intentos' });
      }
    } catch (e) {
      // Falló a mitad: devolver a 'pendiente' (o 'fallido' si agotó intentos) para que NO quede trabado en 'enviando'.
      await sb.from('cola_mensajes').update({ intentos: (m.intentos || 0) + 1, error: String(e).slice(0, 300), estado: (m.intentos || 0) + 1 >= 4 ? 'fallido' : 'pendiente' }).eq('id', m.id);
      fail++;
    }
  }
  return json({ ok: true, sent, fail, caducados: caducados?.length || 0 });
});

// Venezuela: 04141234567 / 0414-1234567 → +584141234567
// U7: antes `if (s.startsWith('58')) return '+' + s` dejaba pasar "580414..." (el 0 de troncal pegado
// al país, típico de "+58 0414-…") → número INVÁLIDO y el mensaje moría en silencio. Se maneja 580→58.
function normalizar(t: string): string {
  let s = (t || '').replace(/\D/g, ''); // solo dígitos (quita +, espacios, guiones)
  if (!s) return '';
  if (s.startsWith('580')) s = '58' + s.slice(3); // quita el 0 de troncal pegado al país
  if (s.startsWith('58')) return '+' + s;
  if (s.startsWith('0')) return '+58' + s.slice(1);
  if (s.length === 10) return '+58' + s;
  return '+' + s;
}
function json(b: unknown) { return new Response(JSON.stringify(b), { headers: { ...CORS, 'Content-Type': 'application/json' } }); }
