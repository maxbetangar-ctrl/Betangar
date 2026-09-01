import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ══════════════════════════════════════════════════════════════════════════════
//  gps-vigilante — avisa cuando el rastreo se calla.
//
//  POR QUÉ EXISTE: un conector caído se ve EXACTAMENTE IGUAL que una flota quieta.
//  No entran filas, y no entrar filas no genera ningún error. Sin esta pieza, el
//  GPS puede dejar de guardar el lunes y nadie enterarse hasta que alguien vaya a
//  buscar el recorrido de la semana y no esté. Y lo que no se guardó no se
//  recupera: el proveedor NO tiene endpoint de historial (probados 31 nombres el
//  14/08/2026), así que el hueco es para siempre.
//
//  VIGILA CINCO COSAS DISTINTAS, y son distintas a propósito:
//   0. 🔴 LA CUENTA DEJÓ DE LISTAR (`?modo=apagon`, cada 5 min) — el proveedor
//      contesta bien pero SIN UNIDADES: no entrega la flota. Se mide el latido
//      del LISTADO (`gps_sync_estado.ultimo_ok`, un minuto), que no depende del
//      motor ni de la hora. ⛔ Se mira ANTES que el apagón de abajo porque el
//      sujeto es otro —la cuenta, no los camiones— y porque el de abajo NO PUEDE
//      VERLO: el 01/09 las 10 unidades se callaron estacionadas y `mudas
//      andando` devolvía 0 con el rastreo entero muerto durante 10 horas.
//   0.b 🔴 APAGÓN DE FLOTA (`?modo=apagon`, cada 5 min) — varias unidades mudas AL
//      MISMO TIEMPO con el motor encendido. Eso no es un camión: es la plataforma
//      del proveedor. Va por su propio camino porque su DESTINATARIO es otro —el
//      contacto del proveedor, con copia adentro— y porque su cadencia es otra:
//      las otras tres se miran dos veces al día, ésta cada cinco minutos.
//   1. 🔴 EL CONECTOR NO CORRE — `gps-sondeo` debería pasar cada 2 minutos. Si hace
//      más de 30 no pasa, no se está guardando NADA de NINGUNA unidad. Es lo más
//      grave y no tiene falsos positivos.
//   2. 🟡 UN EQUIPO SE CALLÓ — la unidad está activa pero su último reporte es
//      viejo. Puede ser el equipo desconectado, sin señal, o el camión sin trabajar.
//   3. 🟡 EL PROVEEDOR RECHAZA — quedó un error guardado en `gps_sync_estado`
//      (clave cambiada, placa dada de baja, API caída).
//
//  ⚠️ QUE NO SE VUELVA UN AVISO QUE SALTA SIEMPRE. Un aviso diario que repite lo
//  mismo se deja de leer, y entonces no avisa de nada. La clave de idempotencia NO
//  lleva la fecha de hoy: lleva **el momento desde el cual la unidad está callada**.
//  Así se avisa UNA VEZ POR EPISODIO: mientras siga muda desde el mismo instante no
//  vuelve a sonar, y si se recupera y se calla de nuevo, eso sí es un episodio nuevo.
//  Un camión parado dos semanas en el taller avisa una vez, no catorce.
//
//  UN SOLO MENSAJE con todo lo que pase, no uno por unidad.
//  `?dry=1` = calcula y devuelve, sin encolar ni marcar nada.
// ══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// ⛔ 584147379886 es MÁXIMO. NO poner 584149614915: ese es el DISPOSITIVO de
// Wassenger, el que ENVÍA, y un número no puede escribirse a sí mismo. Si se pone,
// Wassenger acepta el mensaje —la cola queda en `enviado`— y NUNCA LLEGA. Pasó el
// 14/08/2026 con la primera prueba de esta función.
const AVISAR_A = Deno.env.get("GPS_AVISAR_A") || "584147379886";  // Máximo
const MIN_CONECTOR = 30;   // minutos sin correr el sondeo = está caído
const HS_MUDO = 5;         // horas sin reportar de una unidad activa

// ── Apagón de flota ──────────────────────────────────────────────────────────
const APAGON_MIN_MUDEZ = 10;   // minutos sin reportar para contar como muda
const APAGON_UMBRAL_DEF = 4;   // unidades mudas a la vez para que sea un apagón
const APAGON_ESPERA_MIN = 60;  // no se vuelve a avisar antes de esta espera

// ── La cuenta dejó de listar ─────────────────────────────────────────────────
// Otro sujeto y otro instrumento: no son camiones callados, es el proveedor que
// no entrega la flota. Se mide `gps_sync_estado.ultimo_ok` —el latido del
// LISTADO, que es de un minuto y no depende del motor ni de la hora— y no las
// posiciones, que de noche con el motor apagado llegan una por hora.
const CUENTA_MUDA_MIN = 15;    // minutos sin que la cuenta liste NINGUNA unidad
const CUENTA_RECORDAR_H = 6;   // cada cuánto se repite el aviso ADENTRO mientras dure

// ⛔ LA FRANJA ES PARA LA PERSONA DE AFUERA, NO PARA NOSOTROS. Un aviso a un
// tercero a las 3 de la mañana es una molestia, no una ayuda. Fuera de la franja
// el aviso NO se pierde: sale igual para adentro, diciendo que no se mandó
// afuera y por qué. Lo que no puede pasar es que el silencio de la noche se vea
// igual que una noche sin novedad.
const FRANJA_DESDE = 8;
const FRANJA_HASTA = 20;

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function encolar(rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
}
async function yaAviso(key: string): Promise<boolean> {
  const r = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  return r.length > 0;
}
async function marcar(key: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
}

// La hora que se le muestra a una persona es la del NEGOCIO: Venezuela, UTC-4.
function horaVE(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** Lee una fila de `configuracion`. El valor es TEXT: puede venir serializado o crudo. */
async function cfg(clave: string): Promise<any> {
  const r = await sel(`configuracion?select=valor&clave=eq.${clave}`);
  const v = r[0]?.valor;
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) { console.error("rpc", fn, r.status, await r.text()); return []; }
  return await r.json();
}

/** La hora del NEGOCIO (Venezuela, UTC-4), que es la que decide si se puede escribir. */
function horaNegocio(): number {
  return new Date(Date.now() - 4 * 3600 * 1000).getUTCHours();
}

// ⛔ EL NOMBRE DE LA EMPRESA, PORQUE EL PROVEEDOR ATIENDE A VARIAS DE LAS NUESTRAS.
// Hoy solo Betangar tiene el rastreo, pero la idea es que lo usen todas — y el día
// que dos manden el mismo aviso desde el MISMO número de WhatsApp, un mensaje que
// dice «se nos callaron las unidades» no le dice a nadie de qué flota habla. Del
// otro lado hay una persona con varias cuentas abiertas.
//
// Mismo orden de resolución que `procesar_cola_wassenger` (etiqueta y si no,
// `empresa.nombre`): dos piezas que responden «quién escribe» tienen que responder
// lo mismo. ⚠️ La etiqueta trae emojis por diseño (es la marca anti-spam que se
// antepone a cada mensaje); para el cuerpo de un texto que lee un tercero se le
// sacan, pero NO se inventa nada si no queda nada.
async function nombreEmpresa(): Promise<string | null> {
  const wa = await cfg("wassenger");
  const emp = await cfg("empresa");
  const crudo = String(wa?.etiqueta || emp?.nombre || "").trim();
  const limpio = crudo.replace(/[^\p{L}\p{N}\s.,&'-]/gu, "").trim();
  return limpio || null;
}

function hace(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

Deno.serve(async (req) => {
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const ahora = Date.now();

    const equipos = await sel("gps_equipos?select=cam,placa,placa_proveedor&activo=is.true&order=cam");

    // ── 0. APAGÓN DE FLOTA ───────────────────────────────────────────────────
    // Camino aparte, y a propósito: otro destinatario, otra cadencia y otro texto.
    if (new URL(req.url).searchParams.get("modo") === "apagon") {
      const umbralCfg = await cfg("gps_apagon_umbral");
      let umbral = Number(umbralCfg?.unidades ?? umbralCfg ?? APAGON_UMBRAL_DEF) || APAGON_UMBRAL_DEF;
      let minMudez = APAGON_MIN_MUDEZ;

      // ⚠️ ENSAYO — SOLO EN SECO. Un apagón de flota pasa cada varios días, así que
      // sin esto el camino completo (la consulta, la placa del proveedor, el texto,
      // la franja horaria) se estrenaría el día que hace falta que funcione. Con
      // `?modo=apagon&dry=1&ensayo=1` se baja el umbral a 1 y la mudez a 0, y
      // contesta el mensaje EXACTO que saldría, sin encolar ni marcar nada.
      // ⛔ Va atado a `dry`: sin él se ignora. Un modo de prueba que puede enviar
      // de verdad es un accidente esperando la tecla equivocada.
      if (dry && new URL(req.url).searchParams.get("ensayo") === "1") {
        umbral = 1; minMudez = 0;
      }

      // ── 0.a LA CUENTA DEJÓ DE LISTAR ────────────────────────────────────────
      //
      //  ⛔ SE MIRA ANTES QUE LAS MUDAS ANDANDO, y el sujeto es otro: no es que
      //  varios camiones se hayan callado, es que el proveedor no está
      //  entregando la flota. Si la cuenta está muda, `gps_mudas_andando` no
      //  agrega nada —o no ve nada, que fue lo que pasó el 01/09— y avisar por
      //  los dos caminos sería mandarle dos mensajes distintos del mismo corte.
      //
      //  POR QUÉ HIZO FALTA (01/09/2026): a las 23:49 del 31/08 la cuenta dejó
      //  de listar. Las 10 unidades se habían callado ESTACIONADAS, así que
      //  `gps_mudas_andando` —que solo cuenta motor encendido— devolvía 0 y la
      //  flota se veía sana con el rastreo entero muerto. Diez horas después no
      //  había un solo dato y lo descubrió Máximo mirando la pantalla.
      //  El motor encendido es lo que evita el aviso que salta todas las noches;
      //  también es lo que ciega la alarma cuando el corte empieza de noche.
      const cuentaCfg = await cfg("gps_cuenta_muda_min");
      const esEnsayo = dry && new URL(req.url).searchParams.get("ensayo") === "1";
      // ⚠️ ENSAYO DEL REGRESO. El camino de «volvió» corre UNA sola vez por corte,
      // en el momento en que vuelve: si estuviera mal escrito, se descubriría el
      // día que hace falta y ya sin poder repetirlo. Con `&vuelta=1` se abre la
      // ventana a 24 h, así una cuenta caída hace 12 h figura listando y el camino
      // se recorre entero, en seco. ⛔ Atado a `dry`, como el otro ensayo.
      const minCuenta = esEnsayo
        ? (new URL(req.url).searchParams.get("vuelta") === "1" ? 1440 : 0)
        : (Number(cuentaCfg?.minutos ?? cuentaCfg ?? CUENTA_MUDA_MIN) || CUENTA_MUDA_MIN);
      const cuenta = (await rpc("gps_cuenta_muda", { p_min: minCuenta }))[0];

      if (cuenta?.muda) {
        // ⚠️ EL EPISODIO ES EL CORTE, y su nombre es el minuto del último listado
        // bueno: no cambia mientras el apagón dure, así que al proveedor le sale
        // UN mensaje por corte y no uno por hora. Si la cuenta vuelve y se cae de
        // nuevo, el último listado es otro y eso sí es un episodio nuevo.
        const claveEpisodio = `gps-cuenta-${new Date(cuenta.ultimo_listado).getTime()}`;
        const yaAfuera = await yaAviso(claveEpisodio);

        // La marca de que el episodio está ABIERTO. Se pone en la primera
        // detección y no cambia: es la que busca el aviso de regreso.
        // ⛔ No sirve para eso ninguna de las otras dos: la de afuera solo existe
        // si el mensaje llegó a salir (un corte de madrugada no la tiene hasta las
        // 8:00), y la de adentro lleva el momento del aviso, así que cambia.
        const claveAbierto = `${claveEpisodio}-abierto`;
        const yaAbierto = await yaAviso(claveAbierto);

        // ⚠️ Para ADENTRO sí se repite, cada 6 horas mientras dure. Un aviso a la
        // medianoche y después silencio se lee igual que un apagón que terminó —
        // y el 01/09 la flota estuvo ciega 10 horas sin que nadie lo supiera. Al
        // proveedor no se le repite: ya lo sabe, insistir es pisarle el reclamo.
        //
        // ⛔ LA ESPERA SE MIDE DESDE EL ÚLTIMO AVISO, NO EN BLOQUES DE LA EDAD DEL
        // CORTE. Estaba escrito como `floor(minutos_caída / 6h)`, y eso no es
        // «cada 6 horas»: es «cada vez que la edad cruza un múltiplo de 6». Medido
        // el 01/09 sobre este mismo corte: el primer aviso salió a las 11:20 con
        // 11 h 29 min de caída (bloque 1) y el «recordatorio» salió a las **11:50**
        // (bloque 2). Media hora, no seis. Un corte detectado a las 5 h 59 min
        // habría avisado dos veces en un minuto.
        const previos = await sel(
          `alertas_log?alert_key=like.${claveEpisodio}-in*&select=sent_at&order=sent_at.desc&limit=1`);
        const hDesdeAviso = previos[0]?.sent_at
          ? (Date.now() - new Date(previos[0].sent_at).getTime()) / 3600000
          : Infinity;
        const yaAdentro = hDesdeAviso < CUENTA_RECORDAR_H;
        const claveAdentro = `${claveEpisodio}-in${Date.now()}`;

        const hora = horaNegocio();
        const enFranja = hora >= FRANJA_DESDE && hora < FRANJA_HASTA;
        const prov = await cfg("gps_proveedor_tel");
        const telProv = prov?.tel || null;
        const nomProv = prov?.nombre || "el proveedor";
        const saludo = prov?.nombre ? `Hola, ${String(prov.nombre).split(" ")[0]}.` : "Buenas.";
        const empresa = await nombreEmpresa();
        const desde = horaVE(cuenta.ultimo_listado);
        const cuanto = hace((cuenta.min_sin_listar || 0) * 60000);
        // `hace()` devuelve «hace 11 h», que encaja entre paréntesis pero no dentro
        // de una oración: «Llevamos hace 11 h sin ver la flota» no lo escribe nadie.
        // Se apareció al renderizar el texto EXACTO antes de mandarlo, no leyendo el
        // código. Un texto que va a leer un tercero se mira armado, no en la plantilla.
        const duracion = cuanto.replace(/^hace /, "");

        // ⛔ Al de afuera se le cuenta lo MEDIDO y nada más. La causa no se
        // afirma: «vacío sin error» puede ser su plataforma trabada o la cuenta
        // sin unidades asignadas, y desde acá las dos se ven idénticas. Decirle
        // cuál es sería afirmar lo que nadie midió, y encima ante quien puede
        // comprobarlo contra su propio sistema.
        const paraProveedor =
          `${saludo} Le escribimos de ${empresa}, por el rastreo de nuestra flota.\n\n` +
          `Desde el ${desde} su plataforma dejó de mostrarnos las unidades. Seguimos ` +
          `consultando cada minuto y la respuesta llega bien, pero llega sin unidades: ` +
          `la cuenta no muestra ni uno de nuestros ${cuenta.activas} vehículos. Probamos ` +
          `también placa por placa y responde lo mismo, vacío.\n\n` +
          `Llevamos ${duracion} sin ver la flota y los camiones están trabajando.\n\n` +
          `¿Nos puede revisar si la cuenta quedó sin las unidades asignadas, o si hay algo ` +
          `trabado en la plataforma? Quedamos atentos.`;

        const puedeSalir = Boolean(telProv && empresa && enFranja && !yaAfuera);
        const motivoNoSale = yaAfuera
          ? `✅ Ya se le avisó a ${nomProv} por este mismo corte. No se le vuelve a escribir hasta que la cuenta se recupere.`
          : !telProv
            ? `⛔ NO se le avisó a nadie afuera: falta el teléfono en configuracion.gps_proveedor_tel.`
            : !empresa
              ? `⛔ NO se le avisó a ${nomProv}: no hay nombre de empresa que ponerle al mensaje ` +
                `(configuracion.wassenger.etiqueta o configuracion.empresa).`
              : !enFranja
                ? `🕐 NO se le avisó a ${nomProv} todavía: son las ${String(hora).padStart(2, "0")}:xx ` +
                  `y a un tercero se le escribe entre las ${FRANJA_DESDE}:00 y las ${FRANJA_HASTA}:00. ` +
                  `Sale en cuanto abra la franja.`
                : `✅ Se le avisó a ${nomProv} (${telProv}).`;

        // Los errores que dejó el sondeo distinguen «no vino en el listado» de
        // «vino con el dato ilegible». Para la alarma dan lo mismo; para saber
        // qué reclamar, no.
        const errs = await sel(
          `gps_sync_estado?select=ultimo_error&ultimo_error=not.is.null&limit=200`);
        const distintos = [...new Set(errs.map((e: any) => String(e.ultimo_error).slice(0, 120)))];

        // ⛔ LO PRIMERO QUE SE MIRA NO ES AL PROVEEDOR, ES LA FACTURA.
        //
        //  El 01/09 la cuenta se apagó y todo apuntaba a que la plataforma estaba
        //  rota. La causa real era que **el servicio estaba cortado por falta de
        //  pago**, y el corte cayó en el cambio de mes. Estuvimos a un paso de
        //  reclamarle a la persona del proveedor por una factura nuestra.
        //
        //  Y el instrumento no puede distinguirlas: medido ese día, el API contesta
        //  el MISMO conjunto vacío si la cuenta está suspendida, si el usuario del
        //  servicio no vale, o si simplemente no hay unidades. Lo único que sí
        //  responde distinto es el código de cuenta (da error). Así que la alarma
        //  NO puede afirmar de quién es la culpa: lo que puede hacer es poner la
        //  causa más barata de comprobar donde se lea primero.
        const paraAdentro =
          `🛰️ *El rastreo dejó de entregar — ${empresa || "SIN NOMBRE DE EMPRESA"}*\n\n` +
          `La cuenta no lista NINGUNA de las ${cuenta.activas} unidades activas.\n` +
          `Último listado bueno: ${desde} (${cuanto}).\n\n` +
          `⛔ *Antes de reclamarle al proveedor, comprobá que el servicio esté al día.* ` +
          `Una cuenta cortada por falta de pago se ve EXACTAMENTE igual que su plataforma ` +
          `caída: contesta bien y sin unidades. Ya pasó el 01/09.\n\n` +
          `⛔ No hay posiciones nuevas de ninguna unidad desde entonces, y lo que no se ` +
          `guarda ahora no se recupera: el proveedor no tiene historial.\n\n` +
          (distintos.length ? `Lo que devuelve el sondeo:\n${distintos.map((d) => `• ${d}`).join("\n")}\n\n` : "") +
          motivoNoSale;

        const cola: any[] = [];
        if (!yaAdentro) {
          cola.push({ tipo: "gps_apagon", telefono: AVISAR_A, mensaje: paraAdentro, ref: "gps-cuenta-interno" });
        }
        if (puedeSalir) {
          cola.push({ tipo: "gps_apagon", telefono: telProv, mensaje: paraProveedor, ref: "gps-cuenta-proveedor" });
        }

        if (!dry) {
          // ⛔ La marca de ABIERTO se pone aunque no se mande nada. Es lo que le
          // dice al aviso de regreso que hubo un corte, y no depende de que algún
          // mensaje haya salido.
          if (!yaAbierto) await marcar(claveAbierto);
        }
        if (!dry && cola.length) {
          await encolar(cola);
          if (!yaAdentro) await marcar(claveAdentro);
          // ⛔ La marca de AFUERA solo se pone si el mensaje SALIÓ de verdad. Si
          // el corte empieza de madrugada —como el del 01/09, a las 00:04— el
          // aviso al proveedor espera a las 8:00; marcarlo antes lo dejaría sin
          // mandar para siempre.
          if (puedeSalir) await marcar(claveEpisodio);
        }

        return new Response(JSON.stringify({
          ok: true, modo: "apagon", dry, cuenta_muda: true,
          activas: cuenta.activas, min_sin_listar: cuenta.min_sin_listar,
          ultimo_listado: cuenta.ultimo_listado, minutos_umbral: minCuenta,
          en_franja: enFranja, empresa, al_proveedor: puedeSalir ? telProv : null,
          ya_avisado_afuera: yaAfuera, ya_avisado_adentro: yaAdentro,
          clave: claveEpisodio, mensaje_proveedor: paraProveedor, mensaje_interno: paraAdentro,
        }), { headers: { "Content-Type": "application/json" } });
      }

      // ── 0.a-bis EL RASTREO VOLVIÓ ───────────────────────────────────────────
      //
      //  ⛔ UNA ALARMA QUE NO AVISA DEL REGRESO OBLIGA A MIRAR LA PANTALLA.
      //  El 01/09 el corte duró 12 horas y la única forma de saber si había vuelto
      //  era abrir el mapa cada rato — que es lo mismo que no tener alarma. Un
      //  aviso que solo cuenta la mitad de la historia deja al que lo recibió
      //  esperando sin saber hasta cuándo.
      //
      //  ⚠️ Se avisa SOLO PARA ADENTRO. Que el servicio volvió no es noticia para
      //  el proveedor: él ya lo sabe, y si el corte era nuestro (una factura sin
      //  pagar, como el 01/09) mandarle un «ya volvió» es contarle de más.
      //
      //  El episodio se reconoce por su marca `-abierto`, que se pone SIEMPRE en
      //  la primera detección, se haya mandado algo o no. ⛔ No sirve la marca de
      //  afuera —solo existe si el mensaje llegó a salir, y un corte de madrugada
      //  no la tiene hasta las 8:00— ni la de adentro, que lleva el momento del
      //  aviso y por lo tanto cambia.
      if (cuenta && !cuenta.muda && cuenta.ultimo_listado) {
        const abiertos = await sel(
          `alertas_log?alert_key=like.gps-cuenta-*-abierto&select=alert_key&order=sent_at.desc&limit=1`);
        const claveAb = abiertos[0]?.alert_key || "";
        const msCorte = Number(String(claveAb).replace(/^gps-cuenta-/, "").replace(/-abierto$/, ""));
        if (Number.isFinite(msCorte) && msCorte > 0) {
          const claveVuelta = `gps-cuenta-${msCorte}-vuelta`;
          if (!(await yaAviso(claveVuelta))) {
            const duro = hace(Date.now() - msCorte).replace(/^hace /, "");
            const texto =
              `✅ *El rastreo volvió — ${(await nombreEmpresa()) || "Betangar"}*\n\n` +
              `La cuenta vuelve a listar ${cuenta.listadas} de ${cuenta.activas} unidades.\n` +
              `Estuvo sin entregar ${duro}, desde ${horaVE(new Date(msCorte).toISOString())}.\n\n` +
              `⚠️ Ese rato NO se recupera: el proveedor no guarda historial, así que el ` +
              `recorrido de esas horas no va a existir nunca.`;
            if (!dry) { await encolar([{ tipo: "gps_apagon", telefono: AVISAR_A, mensaje: texto, ref: "gps-cuenta-vuelta" }]); await marcar(claveVuelta); }
            return new Response(JSON.stringify({
              ok: true, modo: "apagon", dry, cuenta_volvio: true,
              listadas: cuenta.listadas, activas: cuenta.activas,
              estuvo_caida: duro, clave: claveVuelta, mensaje_interno: texto,
            }), { headers: { "Content-Type": "application/json" } });
          }
        }
      }

      const mudas = await rpc("gps_mudas_andando", {
        p_min_mudez: minMudez, p_max_h: HS_MUDO,
      });

      if (mudas.length < umbral) {
        return new Response(JSON.stringify({
          ok: true, modo: "apagon", sin_novedad: true,
          mudas_andando: mudas.length, umbral,
        }), { headers: { "Content-Type": "application/json" } });
      }

      // ⚠️ LA ESPERA NO ES POR UNIDAD NI POR DÍA: es por EPISODIO, y un apagón es
      // UNO solo aunque las unidades entren y salgan de la lista minuto a minuto.
      // Con clave por unidad, cada camión que se sumaba al apagón disparaba otro
      // aviso — y el proveedor recibiría cinco mensajes del mismo corte. Con clave
      // por día, dos apagones distintos del mismo día avisarían una sola vez.
      const previas = await sel(
        `alertas_log?alert_key=like.gps-apagon-*&select=sent_at&order=sent_at.desc&limit=1`);
      const ultAviso = previas[0]?.sent_at ? new Date(previas[0].sent_at).getTime() : 0;
      const minDesde = ultAviso ? (ahora - ultAviso) / 60000 : 99999;
      if (minDesde < APAGON_ESPERA_MIN) {
        return new Response(JSON.stringify({
          ok: true, modo: "apagon", callado_por_espera: true,
          mudas_andando: mudas.length, umbral, min_desde_ultimo: Math.round(minDesde),
        }), { headers: { "Content-Type": "application/json" } });
      }

      const placaDe: Record<string, string> = {};
      equipos.forEach((e) => { placaDe[e.cam] = e.placa_proveedor || e.placa || e.cam; });
      const detalle = mudas.map((m: any) =>
        `• ${placaDe[m.cam] || m.cam} (${m.cam}) — último reporte ${horaVE(m.ultimo)}, hace ${m.min_mudo} min`
      ).join("\n");

      const hora = horaNegocio();
      const enFranja = hora >= FRANJA_DESDE && hora < FRANJA_HASTA;
      const prov = await cfg("gps_proveedor_tel");
      const telProv = prov?.tel || null;
      const nomProv = prov?.nombre || "el proveedor";
      // Solo el nombre de pila para el saludo: «Hola, Nombre Apellido» no lo escribe
      // ninguna persona. Y sale de la CONFIGURACIÓN, no del código — este repo es
      // público y el nombre de quien atiende del otro lado no tiene por qué estarlo.
      // ⚠️ Por eso este comentario tampoco lo trae: el 31/08 se cuidó el teléfono y
      // se dejó el nombre completo escrito acá al lado, en el mismo archivo público.
      // El ejemplo de un comentario se publica igual que el código.
      const saludo = prov?.nombre ? `Hola, ${String(prov.nombre).split(" ")[0]}.` : "Buenas.";
      const empresa = await nombreEmpresa();

      // ⛔ El texto de AFUERA no lleva nada nuestro adentro: ni jerga del sistema, ni
      // nada que insinúe que lo escribió una máquina (el candado de `cola_mensajes`
      // lo frenaría, y con razón). La etiqueta de la empresa la antepone el worker.
      //
      // ⛔ Y LA EMPRESA VA EN EL CUERPO, no solo en esa etiqueta. La etiqueta es la
      // marca anti-spam del canal: puede cambiarse, puede faltar, y quien lee un
      // reenvío o una captura no la tiene. El dato de QUIÉN se quedó sin rastreo es
      // parte del reclamo, no del sobre.
      const paraProveedor =
        `${saludo} Le escribimos de ${empresa}, por el rastreo de nuestra flota.\n\n` +
        `Ahora mismo tenemos ${mudas.length} ${mudas.length === 1 ? "unidad que dejó" : "unidades que dejaron"} de reportar posición ` +
        `casi al mismo tiempo, y todas con el motor encendido en el último dato que nos llegó ` +
        `— o sea, con los camiones andando:\n\n${detalle}\n\n` +
        `El odómetro de los equipos sigue sumando kilómetros, así que los camiones se están ` +
        `moviendo: lo que no nos llega es la posición. Y nos pasa que las unidades se van ` +
        `callando en momentos distintos pero vuelven todas en el mismo minuto, que es lo que ` +
        `nos hace pensar que el corte no está en los aparatos.\n\n` +
        `¿Nos puede revisar si hay algo trabado del lado de la plataforma? Quedamos atentos.`;

      // ⛔ SIN NOMBRE DE EMPRESA NO SALE NADA HACIA AFUERA. Un aviso que no dice de
      // qué flota habla no es un aviso a medias: es inservible del lado de quien lo
      // recibe, que atiende varias cuentas nuestras. Y peor, la haría buscar en la
      // equivocada. Cuando falta, el aviso sale igual PARA ADENTRO diciendo qué
      // falta — un dato que no está no puede parecer una noche sin novedad.
      const puedeSalir = Boolean(telProv && empresa && enFranja);
      const motivoNoSale = !telProv
        ? `⛔ NO se le avisó a nadie afuera: falta el teléfono en configuracion.gps_proveedor_tel.`
        : !empresa
          ? `⛔ NO se le avisó a ${nomProv}: no hay nombre de empresa que ponerle al mensaje ` +
            `(configuracion.wassenger.etiqueta o configuracion.empresa). Del otro lado atienden ` +
            `varias cuentas nuestras y un aviso sin empresa no se puede atender.`
          : !enFranja
            ? `🕐 NO se le avisó a ${nomProv} todavía: son las ${String(hora).padStart(2, "0")}:xx ` +
              `y a un tercero se le escribe entre las ${FRANJA_DESDE}:00 y las ${FRANJA_HASTA}:00.`
            : `✅ Se le avisó a ${nomProv} (${telProv}).`;

      const paraAdentro =
        `🛰️ *Apagón del rastreo — ${empresa || "SIN NOMBRE DE EMPRESA"}*\n\n` +
        `${mudas.length} ${mudas.length === 1 ? "unidad muda" : "unidades mudas"} al mismo tiempo ` +
        `con el motor encendido (umbral: ${umbral}):\n\n${detalle}\n\n${motivoNoSale}`;

      const cola: any[] = [{
        tipo: "gps_apagon", telefono: AVISAR_A, mensaje: paraAdentro, ref: "gps-apagon-interno",
      }];
      if (puedeSalir) {
        cola.push({
          tipo: "gps_apagon", telefono: telProv, mensaje: paraProveedor, ref: "gps-apagon-proveedor",
        });
      }

      const clave = `gps-apagon-${new Date(mudas[0].ultimo).getTime()}`;
      if (!dry) { await encolar(cola); await marcar(clave); }

      return new Response(JSON.stringify({
        ok: true, modo: "apagon", dry, aviso: true,
        mudas_andando: mudas.length, umbral, en_franja: enFranja,
        empresa, al_proveedor: puedeSalir ? telProv : null,
        clave, mensaje_proveedor: paraProveedor, mensaje_interno: paraAdentro,
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (!equipos.length) {
      return new Response(JSON.stringify({ ok: true, aviso: "no hay unidades activas" }), {
        headers: { "Content-Type": "application/json" } });
    }
    const estados = await sel("gps_sync_estado?select=cam,bajado_hasta,ultima_corrida,ultimo_ok,ultimo_error");
    const porCam: Record<string, any> = {};
    estados.forEach((e) => { porCam[e.cam] = e; });

    const lineas: string[] = [];
    const claves: string[] = [];

    // ── 1. ¿Está corriendo el conector? ──────────────────────────────────────
    // Se mira la corrida MÁS RECIENTE de todas: alcanza con que una unidad haya
    // sido consultada para saber que el sondeo pasó.
    const corridas = estados.map((e) => e.ultima_corrida).filter(Boolean)
      .map((t: string) => new Date(t).getTime());
    const ultimaCorrida = corridas.length ? Math.max(...corridas) : 0;
    const minSinCorrer = ultimaCorrida ? (ahora - ultimaCorrida) / 60000 : 99999;

    if (minSinCorrer > MIN_CONECTOR) {
      // La clave lleva el momento de la última corrida: mientras siga caído desde
      // el mismo instante, no vuelve a avisar.
      const k = `gps-conector-caido-${ultimaCorrida || "nunca"}`;
      claves.push(k);
      if (!(await yaAviso(k))) {
        lineas.push(
          `🔴 *El rastreo NO se está guardando.*\n` +
          `La última consulta al GPS fue ${ultimaCorrida ? horaVE(new Date(ultimaCorrida).toISOString()) + " (" + hace(ahora - ultimaCorrida) + ")" : "nunca"}, ` +
          `y debería pasar cada 2 minutos.\n` +
          `⚠️ Todo lo que no se guarde ahora NO se recupera después: el proveedor no ` +
          `guarda historial que podamos bajar.`
        );
      } else { claves.pop(); }
    }

    // ── 2. ¿Qué unidades se callaron? ────────────────────────────────────────
    const mudas: string[] = [];
    for (const eq of equipos) {
      const st = porCam[eq.cam];
      const ult = st?.bajado_hasta ? new Date(st.bajado_hasta).getTime() : 0;
      const hs = ult ? (ahora - ult) / 3600000 : 99999;
      if (hs <= HS_MUDO) continue;

      // Clave por EPISODIO (el momento desde el que está muda), no por día.
      const k = `gps-mudo-${eq.cam}-${ult || "nunca"}`;
      if (await yaAviso(k)) continue;
      claves.push(k);
      mudas.push(
        ult ? `• ${eq.cam} — último reporte ${horaVE(st.bajado_hasta)} (${hace(ahora - ult)})`
            : `• ${eq.cam} — nunca ha reportado`
      );
    }
    if (mudas.length) {
      lineas.push(
        `🟡 *${mudas.length} unidad${mudas.length > 1 ? "es" : ""} sin reportar* hace más de ${HS_MUDO} horas:\n` +
        mudas.join("\n") +
        `\nPuede ser el equipo desconectado, sin señal, o el camión sin trabajar.`
      );
    }

    // ── 3. ¿El proveedor está rechazando? ────────────────────────────────────
    const conError = estados.filter((e) => e.ultimo_error);
    const errs: string[] = [];
    for (const e of conError) {
      const k = `gps-error-${e.cam}-${String(e.ultimo_error).slice(0, 40)}`;
      if (await yaAviso(k)) continue;
      claves.push(k);
      errs.push(`• ${e.cam}: ${String(e.ultimo_error).slice(0, 90)}`);
    }
    if (errs.length) {
      lineas.push(`🟡 *El proveedor de GPS está devolviendo error:*\n` + errs.join("\n"));
    }

    if (!lineas.length) {
      return new Response(JSON.stringify({
        ok: true, sin_novedad: true, unidades: equipos.length,
        min_sin_correr: Math.round(minSinCorrer),
      }), { headers: { "Content-Type": "application/json" } });
    }

    const msg = `🛰️ *Rastreo GPS*\n\n` + lineas.join("\n\n");

    if (!dry) {
      await encolar([{ tipo: "gps_vigilante", telefono: AVISAR_A, mensaje: msg, ref: "gps-vigilante" }]);
      for (const k of claves) await marcar(k);
    }

    return new Response(JSON.stringify({
      ok: true, dry, avisos: lineas.length, claves, mensaje: msg,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    // El error se devuelve, no se traga: un vigilante que falla en silencio es
    // peor que no tener vigilante, porque encima da tranquilidad.
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { "Content-Type": "application/json" } });
  }
});
