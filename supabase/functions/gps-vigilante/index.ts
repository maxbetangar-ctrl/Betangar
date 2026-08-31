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
//  VIGILA CUATRO COSAS DISTINTAS, y son distintas a propósito:
//   0. 🔴 APAGÓN DE FLOTA (`?modo=apagon`, cada 5 min) — varias unidades mudas AL
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
      // Solo el nombre de pila para el saludo: «Hola, Enyuly Albarrán» no lo escribe
      // ninguna persona. Y sale de la CONFIGURACIÓN, no del código — este repo es
      // público y el nombre de quien atiende del otro lado no tiene por qué estarlo.
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
