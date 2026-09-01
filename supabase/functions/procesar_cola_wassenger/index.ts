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

// ════════════════════════════════════════════════════════════════════════════
// CANDADO DE MARCA — nada de lo que sale hacia una persona puede insinuar que lo
// escribió una máquina.
//
// POR QUÉ VIVE ACÁ Y NO EN QUIEN ENCOLA (29/08/2026). La norma ya estaba dentro de
// la pieza que manda documentos, pero TODA la mensajería automática de las apps
// sale por esta cola y no pasaba por ningún filtro: dependía de que quien escribe
// el `insert` se acordara. Una regla que depende de la memoria de quien la usa no
// es una regla, es una intención. Va en el único lugar por donde pasan todos.
//
// ⛔ LAS PALABRAS ESTÁN ELEGIDAS PARA NO DAR FALSOS POSITIVOS EN ESPAÑOL, y no es
// un detalle: el mismo 29/08 un candado improvisado frenó un mensaje legítimo por
// la palabra «botón» —buscaba `bot` como palabra suelta, y en JavaScript la `ó`
// acentuada cuenta como separador, así que «bot|ón» daba positivo—. Un candado que
// traba texto bueno se termina desactivando, que es la peor forma de perderlo.
// Por eso NO están: `bot` (botón, robot, bota), `automático` (un «aviso
// automático» no dice quién lo escribió) ni `asistente` solo (hay asistentes que
// son personas).
//
// ⚠️ CADA `\b` HACE FALTA. La primera versión de esta lista los perdió al
// escribirla y quedó sin límites de palabra: así `IA` en mayúsculas casa adentro
// de MARIA, FAMILIA o POLICIA, y el candado habría trabado media mensajería en vez
// de proteger nada. Antes de tocar esto, correr `pruebas/candado-marca.test.mjs`.
const MARCA_PROHIBIDA: Array<[string, RegExp]> = [
  ['inteligencia artificial', /inteligencia\s+artificial/i],
  ['IA (sigla)',              /\bI\.?A\.?\b/],   // sin flag i: «ia» minúscula es final de media lengua
  ['LLM',                     /\bLLM\b/i],
  ['modelo de lenguaje',      /modelo\s+de\s+lenguaje/i],
  ['chatgpt / gpt',           /\bchat\s?gpt\b|\bgpt[\s-]?\d|\bgpt\b/i],
  ['chatbot',                 /\bchat\s?bots?\b/i],
  ['gemini',                  /\bgemini\b/i],
  ['claude',                  /\bclaude\b/i],
  ['openai',                  /\bopen\s?ai\b/i],
  ['anthropic',               /\banthropic\b/i],
  ['copilot',                 /\bcopilot\b/i],
  ['asistente virtual',       /asistente\s+virtual/i],
  ['soy un asistente',        /soy\s+(un|una)\s+(asistente|inteligencia|modelo)/i],
  ['generado por IA',         /generad[oa]s?\s+por\s+(una?\s+)?(inteligencia|ia\b|modelo|máquina)/i],
];

/** Devuelve la etiqueta de lo que se encontró, o null si el texto está limpio. */
export function insinuaMaquina(txt: string): string | null {
  const t = String(txt || '');
  for (const [etiqueta, re] of MARCA_PROHIBIDA) if (re.test(t)) return etiqueta;
  return null;
}

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

  // 1) Recupera mensajes trabados en 'enviando' por una corrida que murió a mitad (>10 min).
  //    `tomado_at` es la marca de RECLAMO; si quedó vieja, la fila vuelve a 'pendiente'.
  //    Antes esta marca era `enviado_at`, que además era la fecha de envío: una fila que fallaba
  //    volvía a 'pendiente' conservando esa fecha y quedaba diciendo que se había enviado algo
  //    que nunca salió (2026-08-07, id 2309: enviado_at puesto con un 502 adentro).
  const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('cola_mensajes').update({ estado: 'pendiente' }).eq('estado', 'enviando').lt('tomado_at', staleTs);
  //    Guardia de transición: una fila reclamada por la versión ANTERIOR tiene enviado_at pero no
  //    tomado_at, y el filtro de arriba no la alcanza (NULL no compara). Sin esto quedaría trabada
  //    en 'enviando' para siempre. Se puede quitar cuando no queden filas viejas en vuelo.
  await sb.from('cola_mensajes').update({ estado: 'pendiente' })
    .eq('estado', 'enviando').is('tomado_at', null).lt('enviado_at', staleTs);

  // 2) mensajes pendientes (tanda)
  const { data: pend } = await sb.from('cola_mensajes').select('*').eq('estado', 'pendiente').lt('intentos', 4).order('id').limit(25);
  if (!pend || !pend.length) return json({ ok: true, sent: 0, caducados: caducados?.length || 0 });

  let sent = 0, fail = 0, bloq = 0;
  const bloqDetalle: Array<{ id: any; tipo: any; marca: string }> = [];
  for (const m of pend) {
    // CLAIM atómico: marca la fila 'enviando' SOLO si sigue 'pendiente'. Si dos corridas del cron se
    // solapan, únicamente una gana el claim; la otra ve 0 filas y salta → sin doble envío.
    const { data: claim } = await sb.from('cola_mensajes')
      .update({ estado: 'enviando', tomado_at: new Date().toISOString() })
      .eq('id', m.id).eq('estado', 'pendiente').select('id').maybeSingle();
    if (!claim) continue; // otra corrida ya lo tomó

    // ⛔ EL CANDADO, ANTES DE RESOLVER NADA MÁS. Si el texto insinúa que lo escribió una
    // máquina, no sale. Y NO se reintenta: el texto no va a cambiar solo, así que gastar
    // los 4 intentos solo escondería el motivo detrás de un 'fallido' genérico. Queda en
    // 'bloqueado' con la palabra encontrada escrita, para corregirlo y volver a encolar.
    const marca = insinuaMaquina(m.mensaje);
    if (marca) {
      await sb.from('cola_mensajes').update({
        estado: 'bloqueado',
        error: `candado de marca: el texto contiene "${marca}", y nada que ve una persona puede insinuar que lo escribio una maquina. Corregi el texto y volve a encolarlo.`,
      }).eq('id', m.id);
      bloq++;
      bloqDetalle.push({ id: m.id, tipo: m.tipo, marca });
      continue;
    }

    try {
      const norm = normalizar(m.telefono, cfg.pais);
      if (!norm.tel) {
        // No se pudo resolver el país: NO se manda. Antes se mandaba con +58 puesto a dedo y el
        // mensaje podía caerle a un venezolano cualquiera. Falla claro y con el motivo escrito.
        await sb.from('cola_mensajes').update({
          estado: 'fallido', intentos: (m.intentos || 0) + 1,
          error: `numero no enviable: ${norm.motivo}. Guardalo con su codigo de pais (ej: 58414…, 57321…, 52951…).`,
        }).eq('id', m.id);
        fail++;
        continue;
      }
      const phone = norm.tel;

      // ── ¿SE LE PUEDE ESCRIBIR A ESTE NÚMERO? ──────────────────────────────
      // ⛔ La lista blanca (`wa_destinos_permitidos` + los teléfonos de `empleados`)
      //    existía en la base y NO LA CONSULTABA NADIE. Con la planilla de alta de
      //    TONY GAS trayendo 9 personas con dos teléfonos distintos, mandar a ciegas
      //    es mandarle información de la operación a quien no es.
      // ⚖️ Falla CERRADO y deja el motivo escrito: la fila queda 'bloqueado', no se
      //    reintenta y se ve por qué. Un mensaje que no sale tiene que verse.
      const { data: permitido, error: errPerm } = await sb.rpc('wa_destino_permitido', { p_tel: phone });
      if (errPerm) {
        // Si NO se pudo comprobar, tampoco se manda: no se adivina hacia afuera.
        await sb.from('cola_mensajes').update({
          estado: 'pendiente', intentos: (m.intentos || 0) + 1,
          error: 'no se pudo comprobar la lista de destinos: ' + String(errPerm.message || errPerm).slice(0, 200),
        }).eq('id', m.id);
        fail++;
        continue;
      }
      if (permitido === false) {
        await sb.from('cola_mensajes').update({
          estado: 'bloqueado', intentos: (m.intentos || 0) + 1,
          error: 'destino no autorizado: ' + phone + '. Agregalo en wa_destinos_permitidos o cargalo como teléfono del empleado.',
        }).eq('id', m.id);
        fail++;
        continue;
      }

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
  // ── LA ALARMA DE LOS BLOQUEADOS ────────────────────────────────────────────
  // Dejar el estado escrito no alcanzaba: el cron corre solo y la respuesta no la lee
  // nadie. Un mensaje frenado del que nadie se entera sigue siendo un silencio, y un
  // silencio se ve igual que todo en orden.
  //
  // ⛔ VA DIRECTO A WASSENGER, NO POR LA COLA, y el motivo no es la velocidad: la alarma
  // nombra la palabra que disparó el candado. Si se encolara, el candado la frenaría a
  // ELLA, eso generaría otra alarma que también se frenaría, y así. Un aviso sobre un
  // filtro no puede pasar por el filtro del que avisa.
  //
  // ⚠️ Lo que esta alarma NO cubre: si Wassenger está caído tampoco sale. Es aceptable
  // porque con Wassenger caído no se procesa nada y no hay bloqueos que avisar — pero
  // queda dicho, no supuesto.
  //
  // ⚠️ El destinatario sale de `configuracion` (clave `alarma_tel`) y NUNCA del código:
  // este repo es público. Si no está configurado, no se inventa un número: se dice en la
  // respuesta que la alarma no tiene a dónde ir.
  let alarma = 'no hubo bloqueados';
  if (bloq > 0) {
    const { data: telRow } = await sb.from('configuracion').select('valor').eq('clave', 'alarma_tel').maybeSingle();
    let telAlarma = '';
    try {
      const v: any = telRow?.valor;
      telAlarma = String((typeof v === 'string' ? (v.trim().startsWith('{') ? JSON.parse(v)?.tel : v) : v?.tel) || '').trim();
    } catch { telAlarma = ''; }

    if (!telAlarma) {
      alarma = 'SIN DESTINATARIO: configurá la clave `alarma_tel` en `configuracion` o nadie se entera de los bloqueos';
    } else {
      const norm = normalizar(telAlarma, cfg.pais);
      if (!norm.tel) {
        alarma = `destinatario no enviable: ${norm.motivo}`;
      } else {
        // No se reproduce el TEXTO del mensaje: se dice qué palabra lo frenó y qué id
        // mirar. Copiar el texto acá sería sacar por otra puerta justo lo que se frenó.
        const detalle = bloqDetalle.slice(0, 5).map((b) => `#${b.id} (${b.tipo || 'sin tipo'}): "${b.marca}"`).join('\n');
        const texto = `${etiqueta ? etiqueta + ': ' : ''}⚠️ El filtro de redacción frenó `
          + `${bloq} mensaje${bloq > 1 ? 's' : ''} y NO se envió a nadie.\n\n${detalle}`
          + `${bloq > 5 ? `\n…y ${bloq - 5} más.` : ''}`
          + `\n\nEstán en la cola con estado "bloqueado" y el motivo escrito. Hay que corregir el texto y volver a encolarlos.`;
        try {
          const ra = await fetch('https://api.wassenger.com/v1/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Token': cfg.token },
            body: JSON.stringify({ phone: norm.tel, message: texto, ...(cfg.device ? { device: cfg.device } : {}) }),
          });
          alarma = (ra.ok || ra.status === 201) ? `avisado (${bloq})` : `no se pudo avisar: HTTP ${ra.status}`;
        } catch (e) {
          alarma = 'no se pudo avisar: ' + String(e).slice(0, 120);
        }
      }
    }
  }

  // `bloqueados` va en la respuesta a propósito: es el respaldo por si la alarma falla.
  return json({ ok: true, sent, fail, bloqueados: bloq, alarma, caducados: caducados?.length || 0 });
});

// Venezuela: 04141234567 / 0414-1234567 → +584141234567
// U7: antes `if (s.startsWith('58')) return '+' + s` dejaba pasar "580414..." (el 0 de troncal pegado
// al país, típico de "+58 0414-…") → número INVÁLIDO y el mensaje moría en silencio. Se maneja 580→58.
// ⛔ EL PAÍS NO SE SUPONE. Sale de la config del tenant (`configuracion.wassenger.pais`).
// Antes esto tenía el 58 metido en el código: `if (s.length === 10) return '+58' + s`, o sea
// CUALQUIER número de 10 dígitos salía como venezolano. Maxware manda y recibe de cualquier
// parte del mundo, y ya hay contactos de México, Colombia y Perú. Consecuencias reales:
//   · 2026-07-18: la bienvenida a Alejandra (+52 México) se mandó como +58 → rechazada.
//   · 2 móviles de Colombia (3xx) idem.
// Y lo peor no es que Wassenger lo rechace: un +58 inventado PUEDE existir y pertenecer a otro,
// así que el mensaje se le iría a un desconocido sin que nadie se entere.
//
// Devuelve { tel } si se pudo resolver, o { motivo } explicando por qué no. Nunca adivina.
function normalizar(t: string, paisDefecto?: string | null): { tel?: string; motivo?: string } {
  let s = (t || '').replace(/\D/g, ''); // solo dígitos (quita +, espacios, guiones)
  if (!s) return { motivo: 'número vacío' };
  if (s.startsWith('00')) s = s.slice(2); // prefijo internacional 00

  const p = String(paisDefecto || '').replace(/\D/g, '');

  // País DUPLICADO: pasó de verdad con Perú (5151992927032 = 51 + 51992927032). Se colapsa una vez.
  if (p && p.length >= 2 && s.startsWith(p + p)) s = s.slice(p.length);

  if (s.startsWith('0')) {
    // Formato nacional (0414…): el 0 es troncal, no parte del número.
    if (!p) return { motivo: 'número en formato nacional (empieza con 0) y el tenant no tiene país configurado' };
    s = p + s.replace(/^0+/, '');
  } else if (p && s.startsWith(p + '0')) {
    // País + 0 de troncal pegados (580414…): el 0 sobra.
    s = p + s.slice(p.length + 1);
  } else if (s.length <= 10) {
    // Sin código de país. NO se adivina: se completa SOLO con el país configurado del tenant.
    if (!p) return { motivo: 'número sin código de país y el tenant no tiene país configurado' };
    s = p + s;
  }

  // E.164: entre 8 y 15 dígitos. Fuera de ahí no se manda: es dato malo, no un país exótico.
  if (s.length < 8 || s.length > 15) return { motivo: `largo inválido: ${s.length} dígitos (E.164 admite 8 a 15)` };
  return { tel: '+' + s };
}
function json(b: unknown) { return new Response(JSON.stringify(b), { headers: { ...CORS, 'Content-Type': 'application/json' } }); }
