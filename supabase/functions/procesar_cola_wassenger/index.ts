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
// de proteger nada. Antes de tocar esto, correr `deno test pruebas/candado-marca.test.ts`
// (36 aserciones; existe desde el 16/10/2026 — hasta ese dia este comentario mandaba correr un
// archivo .mjs que no existia en ninguno de los 5 repos, y el candado no tenia una sola prueba).
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
  // ⚠️ `m[aá]quina`, con y SIN acento: lo encontro `pruebas/candado-marca.test.ts` el 16/10/2026,
  //    el dia que se escribio la primera prueba de este candado. Decia solo `máquina` y
  //    «generado por maquina» -como lo teclea cualquiera en un telefono- pasaba limpio por la
  //    norma inquebrantable. Se compara como la gente escribe, no como se escribe bien.
  ['generado por IA',         /generad[oa]s?\s+por\s+(una?\s+)?(inteligencia|ia\b|modelo|m[aá]quina)/i],
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
  // ⛔ EL RESCATE CUENTA EL INTENTO (16/10/2026). Antes devolvia la fila a 'pendiente' sin
  //    incrementar `intentos`, y ahi estaba el agujero: una corrida que muere DESPUES de que el
  //    mensaje salio y ANTES de marcarlo deja la fila trabada; a los 10 minutos el rescate la
  //    devuelve y se MANDA OTRA VEZ. Como el contador no subia, el tope de 4 (`lt('intentos',4)`)
  //    no actuaba nunca y el ciclo se repetia cada corrida del cron hasta que el caducador de 12 h
  //    lo mataba: decenas de copias del mismo mensaje al mismo telefono.
  //    Se hace fila por fila porque PostgREST no sabe escribir `intentos = intentos + 1`.
  let rescatados = 0;
  {
    const { data: trabadas } = await sb.from('cola_mensajes')
      .select('id,intentos').eq('estado', 'enviando').lt('tomado_at', staleTs).limit(200);
    for (const t of (trabadas || [])) {
      const n = (t.intentos || 0) + 1;
      await sb.from('cola_mensajes').update({
        estado: n >= 4 ? 'fallido' : 'pendiente',
        intentos: n,
        error: 'una corrida murio con este mensaje tomado; puede haber SALIDO sin quedar marcado. '
             + 'Rescatado con el intento contado (' + n + ' de 4)' + (n >= 4 ? ', y agotado: no se reintenta mas.' : '.'),
      }).eq('id', t.id);
      rescatados++;
    }
  }
  //    Guardia de transición: una fila reclamada por la versión ANTERIOR tiene enviado_at pero no
  //    tomado_at, y el filtro de arriba no la alcanza (NULL no compara). Sin esto quedaría trabada
  //    en 'enviando' para siempre. Se puede quitar cuando no queden filas viejas en vuelo.
  await sb.from('cola_mensajes').update({ estado: 'pendiente' })
    .eq('estado', 'enviando').is('tomado_at', null).lt('enviado_at', staleTs);

  // ⛔ EL CORTE POR CREDENCIAL SE MUEVE AQUI ABAJO, DESPUES DE LIMPIAR LA COLA (16/10/2026).
  //    Estaba ARRIBA del caducador y del rescate, asi que una base SIN canal nunca caducaba
  //    nada, nunca rescataba nada y nunca alarmaba: el worker se iba en esta linea.
  //    Lo que figuro un mes como "hay que decidir si se limpia la alarma trancada del 11/09 de
  //    la DEMO" no era una decision pendiente: era que el codigo NO PODIA limpiarla. Mismo caso
  //    en VIDECA. Limpiar la cola no necesita credencial -son updates a nuestra propia base-;
  //    lo unico que necesita token es ENVIAR. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
  if (!cfg.token || cfg.activo === false) {
    return json({
      ok: true, sent: 0,
      nota: 'Wassenger no configurado o desactivado — nada que enviar',
      caducados: caducados?.length || 0, rescatados,
    });
  }

  // 1.5) ¿EL CANAL ESTÁ EN PIE? SE PREGUNTA ANTES DE ENTREGARLE NADA (21/10/2026)
  //
  // ⛔ POR QUÉ. Entregar un mensaje a un canal caído DESARMA nuestra propia caducidad.
  //    El caducador de arriba solo toca filas en 'pendiente'; en cuanto hacemos el POST
  //    la fila pasa a 'enviado' y ya nadie la puede frenar. Wassenger ACEPTA el POST con
  //    la sesión en `authorize` (sin teléfono enlazado), se lo guarda, y lo suelta cuando
  //    vuelve — días después. Desde nuestro lado nunca hubo retraso: encolado 17:00,
  //    entregado al proveedor 17:03, 'enviado' ✅. Los 12 h de vigencia no se gastan nunca.
  //
  // 📌 MEDIDO EL 21/10/2026, con los acuses del propio proveedor (`events.delivered.date`):
  //    el recordatorio de VIAJES del 10/10 17:04 le llegó a Gladis el 13/10 11:29 — 66 h
  //    tarde— y tres de los de Alejandra cayeron juntos el 18/10 15:57, el aluvión clásico
  //    de una cola represada que se vacía de golpe. Dos salieron a la 01:53, fuera de la
  //    franja 8:00–20:00 que la casa respeta al ENCOLAR. Lo reportó ella: «los mensajes de
  //    recordatorios están llegando muy tarde».
  //    ⇒ Un aviso operativo que llega 3 días tarde no es un aviso tarde: es uno FALSO,
  //      porque dice «hoy» de un día que ya pasó.
  //
  // ⇒ Si el canal no está en pie, NO se entrega: las filas se quedan en 'pendiente' y el
  //   caducador de arriba hace su trabajo en la próxima corrida. Preferimos que un aviso
  //   operativo CADUQUE a que llegue fuera de su día.
  //   [[norma-probar-el-camino-no-la-pieza]] · [[norma-la-caducidad-solo-cubre-el-tramo-propio]]
  //
  // ⚠️ `status: 'operative'` NO dice que esté conectado: manda `session.status`. Y un aparato
  //    online con la cola del proveedor trancada tampoco entrega. Las dos cosas las sabía
  //    `maxware-tools/puede-hablar.mjs` desde hacía semanas; acá faltaban.
  if (cfg.device) {
    try {
      const rd = await fetch('https://api.wassenger.com/v1/devices/' + cfg.device, { headers: { 'Token': cfg.token } });
      if (rd.ok) {
        const motivo = canalCaido(await rd.json());
        if (motivo) {
          return json({
            ok: true, sent: 0,
            nota: `canal caído: ${motivo} — NO se entrega nada; lo pendiente caduca a las ${VIGENCIA_HORAS}h`,
            caducados: caducados?.length || 0, rescatados,
          });
        }
      }
      // rd no ok: se sigue. No poder PREGUNTAR por el canal no es prueba de que esté caído.
    } catch { /* sin red para preguntar: se sigue, igual que arriba */ }
  }

  // 2) mensajes pendientes (tanda)
  const { data: pend } = await sb.from('cola_mensajes').select('*').eq('estado', 'pendiente').lt('intentos', 4).order('id').limit(25);
  if (!pend || !pend.length) return json({ ok: true, sent: 0, caducados: caducados?.length || 0 });

  let sent = 0, fail = 0, bloq = 0, trabado = 0;
  const bloqDetalle: Array<{ id: any; tipo: any; marca: string }> = [];
  // `trabado` = filas que NO SE PUDIERON NI COMPROBAR (el control de destino fallo). No son
  // bloqueos -siguen 'pendiente' y se reintentan- pero avisan igual: ver el bloque de errPerm.
  const trabadoDetalle: Array<{ id: any; tipo: any; motivo: string }> = [];
  // ⛔ `bloq` cuenta TODO lo que se freno, no solo el candado de redaccion. Ver el
  //    bloque del destino no autorizado, mas abajo, para el porque.
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
        // ⛔ ESTO TIENE QUE DISPARAR LA ALARMA (16/10/2026). Antes hacia `fail++` y la alarma solo
        //    mira los frenados: si a `wa_destino_permitido` se le cambia la firma -y esa funcion
        //    NO esta en ninguna migracion de ningun repo, o sea que vive fuera de git-, NINGUN
        //    mensaje sale en NINGUNA de las 5 bases, cada fila gasta sus 4 intentos, a las 12 h el
        //    caducador las descarta y la alarma no suena una sola vez. Silencio identico a "no
        //    habia nada que mandar", que es el peor de los dos.
        //    La fila queda 'pendiente' a proposito: un fallo del control puede ser pasajero y el
        //    mensaje tiene que poder salir en la proxima. Lo que NO puede es ser silencioso.
        //    [[norma-la-alarma-no-sale-por-el-canal-que-vigila]] [[norma-una-funcion-de-base-es-codigo-fuera-de-git]]
        trabado++;
        trabadoDetalle.push({ id: m.id, tipo: m.tipo, motivo: String(errPerm.message || errPerm).slice(0, 120) });
        fail++;
        continue;
      }
      if (permitido === false) {
        await sb.from('cola_mensajes').update({
          estado: 'bloqueado', intentos: (m.intentos || 0) + 1,
          error: 'destino no autorizado: ' + phone + '. Agregalo en wa_destinos_permitidos o cargalo como teléfono del empleado.',
        }).eq('id', m.id);
        // ⛔ ESTO CUENTA PARA LA ALARMA. Hasta el 11/09/2026 hacia `fail++` y se iba:
        //    la fila quedaba 'bloqueado' con el motivo escrito, pero la alarma solo
        //    miraba `bloq`, que unicamente contaba el candado de redaccion. O sea que
        //    un mensaje frenado por destino NO AVISABA A NADIE.
        //    Costo concreto: al C.E.O. de Tony Gas se le frenaron 4 pedidos de
        //    aprobacion (04/09 y 08/09) porque su telefono no estaba cargado donde la
        //    puerta lo lee. Dos requisiciones quedaron 7 y 3 dias en `espera_firma`
        //    esperando una firma que nunca se le pidio. Nadie lo noto: un mensaje
        //    frenado se ve EXACTAMENTE IGUAL que no tener nada que mandar.
        //    [[norma-la-alarma-no-sale-por-el-canal-que-vigila]]
        bloq++;
        bloqDetalle.push({ id: m.id, tipo: m.tipo, marca: 'destino no autorizado (' + phone + ')' });
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
        // ⛔ SE GUARDA EL ID QUE DEVUELVE EL PROVEEDOR. Hasta el 11/09/2026 la
        //    respuesta se tiraba a la basura: se miraba `r.ok` y nada mas. Por eso
        //    nuestro 'enviado' solo queria decir «Wassenger acepto el pedido», y
        //    despues NO habia con que preguntarle si el mensaje llego al telefono
        //    de la persona. Costo dos dias de «a Fulana no le llegan los
        //    recordatorios» sin poder contestar. Con el id se consulta el estado
        //    real (delivered / read / se quedo en sent), que es lo unico que
        //    prueba entrega. Nuestro 'enviado' es palabra nuestra.
        let idProv: string | null = null;
        let wid: string | null = null;
        try {
          const j = await r.json();
          idProv = (j && (j.id || j._id || (Array.isArray(j) ? j[0]?.id : null))) || null;
          wid = destinoDelMensaje(j);
          if (!wid) console.log('aviso: el proveedor no dijo a que chat fue el mensaje ' + idProv + '; no se pudo comprobar el destino');
        } catch (_) { /* si no devuelve JSON el envio igual salio: no se pierde por esto */ }

        // ══════════════════════════════════════════════════════════════════════
        // ⛔ ¿EL DESTINO ES A QUIEN LE ESCRIBIMOS? (15/10/2026)
        //
        // El destino real NO es el `phone` que mandamos: es el `wid` que devuelve
        // el proveedor. El 12/10 el MISMO numero de Alejandra resolvio unas veces
        // a `5219512180813@c.us` (su chat real) y otras a `529512180813@c.us`,
        // que NO EXISTE: Wassenger le come el «1» a los moviles de Mexico segun
        // algo que no controlamos. Esos mensajes salen 'processed', se evaporan, y
        // sin acuses desde el 29/09 se ven IDENTICOS a uno entregado.
        // [[norma-el-destino-de-un-mensaje-es-el-wid]]
        //
        // ⚠️ POR QUE NO SE BLOQUEA POR «EL CHAT NO EXISTE», que seria lo obvio:
        //    un empleado que nunca le escribio al numero de la empresa NO TIENE
        //    conversacion, y es lo normal — WhatsApp la crea con el primer
        //    mensaje. Ese candado le cortaria el PRIMER aviso a cada persona
        //    nueva, y encima en silencio.
        //    [[norma-un-candado-que-rompe-la-herramienta-es-peor]]
        //
        // ⇒ El unico indicio inequivoco es que el proveedor CAMBIE LOS DIGITOS.
        //   Si los cambio, se pregunta si ESE chat existe: si existe, nos corrigio
        //   hacia la cuenta real y se deja pasar (queda en el log); si no existe,
        //   el mensaje se CANCELA y la fila queda 'bloqueado' — que es el unico
        //   estado que alguien mira. Si los digitos coinciden, no se pregunta
        //   nada: ahi no hay nada que dudar.
        // ══════════════════════════════════════════════════════════════════════
        if (cfg.device && cambioElDestino(wid, phone)) {
          let existe = false, estadoChat = 0;
          try {
            const ch = await fetch('https://api.wassenger.com/v1/chat/' + cfg.device + '/chats/' + wid, { headers: { 'Token': cfg.token } });
            estadoChat = ch.status;
            existe = ch.ok;
          } catch (_) {
            // Si NO SE PUDO PREGUNTAR, no se bloquea: el mensaje ya salio y una
            // falla de red nuestra no es prueba de que el destino este mal.
            existe = true;
            console.log('no se pudo comprobar el chat ' + wid + '; se deja pasar');
          }
          if (!existe) {
            if (idProv) {
              try {
                await fetch('https://api.wassenger.com/v1/messages/' + idProv, { method: 'DELETE', headers: { 'Token': cfg.token } });
              } catch (_) { /* si no se pudo cancelar, igual se reporta: peor es callarlo */ }
            }
            await sb.from('cola_mensajes').update({
              estado: 'bloqueado', intentos: (m.intentos || 0) + 1,
              error: 'el proveedor cambio el destino: se pidio ' + phone + ' y resolvio a ' + wid + ', donde no hay conversacion (HTTP ' + estadoChat + '). El mensaje fue CANCELADO para que no se pierda en silencio. Corregi el numero en la ficha del empleado: un movil de Mexico va 521 + 10 digitos.',
            }).eq('id', m.id);
            bloq++;
            bloqDetalle.push({ id: m.id, tipo: m.tipo, marca: 'el proveedor cambio el destino (' + phone + ' -> ' + wid + ', sin conversacion)' });
            continue;
          }
          console.log('aviso: ' + phone + ' resolvio a ' + wid + ', que SI tiene conversacion; se deja pasar');
        }

        // error:null — al salir bien se BORRA el error del intento fallido anterior. Si no, un
        // mensaje que se reintento y llego queda "enviado" pero mostrando un error viejo, y quien
        // lo mire va a creer que no salio (paso el 2026-07-20 con un 502: llego en el reintento
        // pero el registro parecia fallido).
        const marca = { estado: 'enviado', enviado_at: new Date().toISOString(), error: null };

        // ⛔ EL MENSAJE YA SALIO: marcarlo NO puede fallar por la columna nueva.
        //    Si PostgREST todavia tiene el esquema viejo en cache, el update con
        //    `proveedor_id` da 400, la fila se queda en 'pendiente' y el ciclo
        //    siguiente LO MANDA OTRA VEZ. Una mejora de trazabilidad no puede
        //    terminar en mensajes duplicados a un cliente: se reintenta sin el id.
        const up = await sb.from('cola_mensajes').update({ ...marca, proveedor_id: idProv }).eq('id', m.id);
        if (up.error) {
          console.log('proveedor_id no se pudo guardar (' + up.error.message + '); se marca igual');
          await sb.from('cola_mensajes').update(marca).eq('id', m.id);
        }
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
  if (bloq > 0 || trabado > 0) {
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
        // Los dos casos se nombran distinto porque se arreglan distinto: el BLOQUEADO hay que
        // corregirlo y volver a encolarlo; el que no se pudo comprobar se arregla arreglando el
        // control, y mientras tanto NO SALE NADA en esta base.
        const detTrab = trabadoDetalle.slice(0, 3).map((b) => `#${b.id} (${b.tipo || 'sin tipo'}): ${b.motivo}`).join('\n');
        const texto = `${etiqueta ? etiqueta + ': ' : ''}⚠️ `
          + (bloq > 0
              ? `Se frenaron ${bloq} mensaje${bloq > 1 ? 's' : ''} y NO se enviaron a nadie.\n\n${detalle}`
                + `${bloq > 5 ? `\n…y ${bloq - 5} más.` : ''}`
                + `\n\nEstán en la cola con estado "bloqueado" y el motivo escrito. Hay que corregir el texto y volver a encolarlos.`
              : '')
          + (trabado > 0
              ? `${bloq > 0 ? '\n\n— — —\n\n' : ''}🚨 ${trabado} mensaje${trabado > 1 ? 's' : ''} NO se pudieron ni comprobar: `
                + `fallo el control de destinos permitidos. Mientras eso falle, de esta base NO SALE NINGUN mensaje.\n\n${detTrab}`
              : '');
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
// ════════════════════════════════════════════════════════════════════════════
// ⛔ ¿A QUIEN LE FUE EL MENSAJE DE VERDAD?
//
// Exportadas a proposito, como `insinuaMaquina`: una decision que CANCELA un
// mensaje tiene que poder probarse sin mandar ninguno.
// [[norma-probar-el-camino-no-la-pieza]]
//
// ⚠️ El campo del destino CAMBIA segun el endpoint, medido el 15/10/2026:
//    · POST /messages          → `wid`
//    · el mensaje ya guardado  → `chat` y `to`, STRINGS ("5219512180813@c.us"),
//                                y NINGUN `wid`
//    Un `chat?.id` solo —que era lo que parecia razonable— da `undefined` sobre
//    la forma guardada y deja el candado MUDO. Se buscan todos, en orden.
// ════════════════════════════════════════════════════════════════════════════
export function destinoDelMensaje(j: any): string | null {
  const c = Array.isArray(j) ? j[0] : j;
  if (!c || typeof c !== 'object') return null;
  if (typeof c.wid === 'string' && c.wid) return c.wid;
  if (typeof c.chat === 'string' && c.chat) return c.chat;
  if (c.chat && typeof c.chat.id === 'string' && c.chat.id) return c.chat.id;
  if (typeof c.to === 'string' && c.to) return c.to;
  return null;
}

// true SOLO si el proveedor mando el mensaje a otros digitos de los que pedimos.
// Un destino que no se pudo leer NO es un cambio de destino: es que no se sabe.
export function cambioElDestino(destino: string | null, phone: string): boolean {
  if (!destino || !destino.endsWith('@c.us')) return false;
  const d = (x: string) => String(x || '').replace(/[^0-9]/g, '');
  if (!d(destino) || !d(phone)) return false;
  return d(destino) !== d(phone);
}

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

// ¿El canal está caído? Devuelve el MOTIVO en castellano, o null si está en pie.
// Las formas salen de medir `GET /devices/:id` el 21/10/2026, no de suponerlas.
//   · `status: 'operative'` NO dice que esté conectado — manda `session.status`.
//   · un aparato online con `session.queue.status != 'active'` tampoco entrega.
// ⛔ CONTROL POSITIVO: un campo que NO VINO se lee igual que uno en falso. Si la API
//    cambia y deja de mandar `session`, esto NO frena la cola: devuelve null y se envía.
//    Frenar toda la casa por no encontrar una clave sería peor que el problema que arregla.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
export function canalCaido(d: any): string | null {
  const ses = d?.session?.status;
  if (ses !== undefined && ses !== 'online') {
    return `la sesión del teléfono no está conectada (session.status = "${ses}")`;
  }
  const q = d?.session?.queue;
  if (q?.status !== undefined && q.status !== 'active') {
    return `la cola del proveedor no está activa (queue.status = "${q.status}", ${q?.size ?? '?'} parado(s))`;
  }
  return null;
}
