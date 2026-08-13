// ════════════════════════════════════════════════════════════════════════════
// Worker de CORREO por RESEND (procesa la cola `cola_correos`).
//
// POR QUÉ EXISTE (13/08/2026): la auditoría profunda de las 6 AM corría bien
// todos los días y NUNCA entregó un correo en 8 días. Mandaba por Resend desde
// el sandbox de la rutina, y el proxy de egreso de ese entorno bloquea
// api.resend.com (403 al CONNECT). El respaldo, Gmail, solo crea BORRADORES.
//
// Acá la salida a internet la hace SUPABASE, no el sandbox. La rutina solo
// encola con un INSERT. Es el mismo camino del WhatsApp (cola_mensajes +
// procesar_cola_wassenger), que sí llega todos los días.
//
// Credencial: `configuracion`, clave='resend', valor={apikey, from}. No va en
// el código ni en el cron ([[cron-secreto-fuera-del-job]]).
//
// Deploy: supabase functions deploy procesar_cola_correos --project-ref hrkjddehqnzcqwlkklqm
// Cron: cada 5 min (pg_cron → pg_net).
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

// Un informe de auditoría que no salió en 24 h ya no sirve: la corrida del día
// siguiente trae el estado al día. Se DESCARTA con el motivo escrito, no se borra.
const VIGENCIA_HORAS = 24;
const MAX_INTENTOS = 4;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) Credencial (de la config, no del código)
  const { data: cfgRow } = await sb.from('configuracion').select('valor').eq('clave', 'resend').maybeSingle();
  let cfg: any = {};
  try { cfg = cfgRow?.valor ? (typeof cfgRow.valor === 'string' ? JSON.parse(cfgRow.valor) : cfgRow.valor) : {}; } catch { cfg = {}; }
  if (!cfg.apikey) {
    // Se dice en voz alta. Una cola que no puede mandar y calla se ve igual que una cola vacía.
    return json({ ok: false, sent: 0, nota: 'FALTA la credencial de Resend en configuracion (clave=resend)' }, 500);
  }
  const remitentePorDefecto = cfg.from || 'MAXWARE <reportes@maxware.app>';

  // 2) Caducar lo viejo ANTES de mandar nada: si la cola venía represada, esto
  //    evita el aluvión de informes atrasados en cuanto el servicio vuelve.
  const corte = new Date(Date.now() - VIGENCIA_HORAS * 3600 * 1000).toISOString();
  const { data: caducados } = await sb.from('cola_correos')
    .update({ estado: 'descartado', error: `caducado: encolado hace mas de ${VIGENCIA_HORAS}h; el informe del dia siguiente ya trae el estado al dia` })
    .eq('estado', 'pendiente').lt('created_at', corte).select('id');

  // 3) Rescatar lo trabado en 'enviando' por una corrida que murió a mitad.
  //    `tomado_at` es la marca de RECLAMO, nunca la fecha de envío — si se usara
  //    `enviado_at` para esto, una fila fallida quedaría diciendo que salió algo
  //    que nunca salió (le pasó a la cola de WhatsApp el 07/08).
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('cola_correos').update({ estado: 'pendiente' }).eq('estado', 'enviando').lt('tomado_at', stale);

  // 4) Tanda de pendientes
  const { data: pend } = await sb.from('cola_correos')
    .select('*').eq('estado', 'pendiente').lt('intentos', MAX_INTENTOS).order('id').limit(10);
  if (!pend?.length) return json({ ok: true, sent: 0, caducados: caducados?.length || 0 });

  let sent = 0, fail = 0;
  for (const m of pend) {
    // CLAIM atómico: pasa a 'enviando' SOLO si sigue 'pendiente'. Si dos corridas
    // del cron se solapan, una gana y la otra salta → nunca dos correos iguales.
    const { data: claim } = await sb.from('cola_correos')
      .update({ estado: 'enviando', tomado_at: new Date().toISOString() })
      .eq('id', m.id).eq('estado', 'pendiente').select('id').maybeSingle();
    if (!claim) continue;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apikey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: m.remitente || remitentePorDefecto,
          to: m.para.split(',').map((s: string) => s.trim()).filter(Boolean),
          subject: m.asunto,
          html: m.html,
        }),
      });

      if (r.ok) {
        // error:null — se limpia el error del intento anterior. Si no, un correo
        // que se reintentó y llegó queda "enviado" mostrando un error viejo, y
        // quien lo mire va a creer que no salió.
        await sb.from('cola_correos')
          .update({ estado: 'enviado', enviado_at: new Date().toISOString(), error: null }).eq('id', m.id);
        sent++;
      } else {
        const t = (await r.text()).slice(0, 400);
        // 429 = límite de ritmo de Resend. NO gasta intentos: si se queman los 4,
        // el informe muere por una cuota y no por un problema suyo. Se corta la
        // tanda — insistir en la misma corrida no ayuda. (Lección de Wassenger 20/07.)
        const esCuota = r.status === 429;
        await sb.from('cola_correos').update({
          intentos: esCuota ? m.intentos : m.intentos + 1,
          error: `HTTP ${r.status}: ${t}`,
          estado: (!esCuota && m.intentos + 1 >= MAX_INTENTOS) ? 'fallido' : 'pendiente',
        }).eq('id', m.id);
        fail++;
        if (esCuota) return json({ ok: false, sent, fail, nota: 'Resend limitando el ritmo (429) — la cola queda intacta' });
      }
    } catch (e) {
      // Murió a mitad: vuelve a 'pendiente' para que NO quede trabado en 'enviando'.
      await sb.from('cola_correos').update({
        intentos: m.intentos + 1,
        error: String(e).slice(0, 400),
        estado: m.intentos + 1 >= MAX_INTENTOS ? 'fallido' : 'pendiente',
      }).eq('id', m.id);
      fail++;
    }
  }
  return json({ ok: true, sent, fail, caducados: caducados?.length || 0 });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
