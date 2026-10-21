// ══════════════════════════════════════════════════════════════════════════════
//  gps-reenvio — le manda a IMAU Flota (la plataforma de la Alcaldía) cada
//                posición que el sondeo ya guardó en `gps_posiciones`.
//
//  Escrito el 21/10/2026 con la especificación que dio Leonel, el técnico de la
//  Alcaldía, ese mismo día. IMAU Flota la desarrollan y administran ellos.
//
//  ⛔ EL REQUISITO QUE MANDA (Máximo, 21/10): «debe ser los datos más exactos
//     posibles porque después la Alcaldía puede pensar que no estuve en un sitio
//     que sí estuve». Todo lo de abajo sale de ahí.
//
//  CORRE EN LA NUBE, NO EN LA PC DE NADIE. Es una edge function con su cron,
//  igual que `gps-sondeo`: la computadora de la oficina puede estar apagada.
//
//  EL PROTOCOLO: OsmAnd (el de Traccar Client), por HTTP GET.
//    <url>?id=<IMEI>&lat=..&lon=..&timestamp=<segundos Unix>&speed=<NUDOS>&bearing=..
//
//  ⚠️ LA TRAMPA QUE HABÍA QUE MEDIR: `speed` VA EN NUDOS Y LA NUESTRA ESTÁ EN
//     km/h. Medido el 21/10 con 2.399 muestras: la distancia real entre
//     posiciones consecutivas da 0,86 de la velocidad reportada — eso es km/h
//     (con nudos la razón tendría que ser ~1,85; con millas ~1,6). Mandarla tal
//     cual mostraría 83 donde el camión va a 45, y haría ver a los choferes
//     corriendo en el mapa de la Alcaldía. Por eso se divide por 1,852.
//
//  ⚠️ EL `timestamp` ES EL DE LA POSICIÓN, NUNCA EL DEL ENVÍO. Si se mandara la
//     hora de ahora, los huecos del equipo del proveedor desaparecerían del mapa
//     y la línea afirmaría que el camión estaba en un lugar a una hora en que no
//     se sabía dónde estaba. Un hueco honesto se defiende; una línea inventada no.
//
//  LAS CUATRO REGLAS QUE PROTEGEN LA EXACTITUD
//
//  1. EL CURSOR NO AVANZA SOBRE UN FALLO. Se manda en orden cronológico y, al
//     primer error de una unidad, se corta ahí y se deja el cursor en la última
//     que SÍ salió. La corrida siguiente retoma justo ahí. Si avanzara igual,
//     una caída de red se volvería un hueco permanente — el «no estuve».
//
//  2. NADA SE MANDA DOS VECES NI SE SALTEA. `gps_posiciones` es append-only con
//     llave única (cam, ts); el cursor por unidad alcanza. ⚠️ Y alcanza porque el
//     API del proveedor NO tiene historial: no puede aparecer una posición más
//     vieja que el cursor. Si algún día lo tuviera, esta regla deja de servir.
//
//  3. SE CUENTA LO QUE SALE (`gps_reenvio_dia`). «Se mandó todo» es una
//     impresión; «de 1.504 posiciones del martes salieron 1.504» es un dato.
//     Eso es lo que contesta `gps_reenvio_cuadre()`.
//
//  4. EL IMEI ES EL DECLARADO en `gps_equipos.imei`, no el que vino en la
//     posición. Si difieren, es un aparato cambiado de camión y tiene que
//     gritar (`gps_reenvio_imei_discrepante()`), no corregirse en silencio.
//
//  ⛔ LA DIRECCIÓN NO ESTÁ EN ESTE ARCHIVO. Ese endpoint no lleva usuario ni
//     clave —identifica al equipo solo por el IMEI—, así que la dirección es en
//     la práctica la credencial, y este repo es PÚBLICO. Vive en
//     `configuracion.gps_reenvio_url`.
//
//  MODOS
//    POST {}                      → corrida normal
//    POST {"dry":true}            → recorre el camino COMPLETO y no manda nada.
//                                   Imprime la URL que mandaría. Para estrenar
//                                   la pieza sin estrenarla el día que importa.
//    POST {"cam":"JAC-B003"}      → una sola unidad
//    POST {"tope":50}             → cuántas posiciones por unidad en esta corrida
// ══════════════════════════════════════════════════════════════════════════════

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const KEY_SB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAVE  = Deno.env.get("GPS_CRON_KEY") || "";

const TOPE_DEF  = 200;     // posiciones por unidad y por corrida
const PLAZO_MS  = 10000;   // una llamada sin plazo cuelga la corrida entera
const KMH_A_NUDOS = 1.852;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const cabSb = {
  apikey: KEY_SB,
  Authorization: `Bearer ${KEY_SB}`,
  "Content-Type": "application/json",
};

async function sb(ruta: string, init?: RequestInit) {
  const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, {
    ...init,
    headers: { ...cabSb, ...(init?.headers || {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

/** La hora de Venezuela para fechar el contador del día. UTC-4 fijo. */
function diaVE(iso: string): string {
  return new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Una posición, en el formato que espera IMAU Flota.
 * ⚠️ `speed` sale en NUDOS. `timestamp` es el de la posición.
 */
function armarUrl(base: string, imei: string, p: any): string {
  const u = new URL(base);
  u.searchParams.set("id", imei);
  u.searchParams.set("lat", String(p.lat));
  u.searchParams.set("lon", String(p.lon));
  u.searchParams.set("timestamp", String(Math.floor(new Date(p.ts).getTime() / 1000)));
  // Una velocidad que no vino NO se manda como 0: un 0 afirma «estaba parado»,
  // y no saber a qué iba no es lo mismo que saber que no se movía.
  if (p.velocidad !== null && p.velocidad !== undefined) {
    u.searchParams.set("speed", (Number(p.velocidad) / KMH_A_NUDOS).toFixed(2));
  }
  if (p.rumbo !== null && p.rumbo !== undefined) {
    u.searchParams.set("bearing", String(Math.round(Number(p.rumbo))));
  }
  return u.toString();
}

async function mandarUna(url: string): Promise<void> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), PLAZO_MS);
  try {
    const r = await fetch(url, { method: "GET", signal: ctrl.signal });
    const txt = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 120)}`);
  } finally {
    clearTimeout(reloj);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (CLAVE && (req.headers.get("x-api-key") || "") !== CLAVE) {
    return json({ ok: false, error: "no autorizado" }, 401);
  }

  const body = await req.json().catch(() => ({} as any));
  const dry  = body?.dry === true;
  const tope = Math.max(1, Math.min(1000, Number(body?.tope) || TOPE_DEF));
  const soloCam = typeof body?.cam === "string" ? body.cam : null;
  const t0 = Date.now();

  try {
    // ── La dirección y el interruptor viven en `configuracion` ──────────────
    const cfg = await sb(`configuracion?clave=in.(gps_reenvio_url,gps_reenvio_activo)&select=clave,valor`);
    const mapa: Record<string, string> = {};
    for (const f of cfg || []) mapa[f.clave] = f.valor;

    const base = (mapa["gps_reenvio_url"] || "").trim();
    if (!base) {
      // ⛔ Un «no hay URL» tiene que decir QUÉ falta y DÓNDE se pone. Un mensaje
      // negativo que no nombra la causa manda a buscar la falla a ciegas.
      return json({
        ok: false,
        error: "falta `configuracion.gps_reenvio_url`: sin la dirección de IMAU Flota no hay a dónde mandar",
      }, 412);
    }
    // El interruptor permite cortar el envío a un tercero SIN redesplegar.
    if ((mapa["gps_reenvio_activo"] || "true").toLowerCase() === "false" && !dry) {
      return json({ ok: true, apagado: true, nota: "gps_reenvio_activo=false: no se mandó nada a propósito" });
    }

    // ── Las unidades que se pueden mandar ───────────────────────────────────
    // Sin IMEI declarado NO se manda: un `id` vacío le mete a la Alcaldía un
    // camión fantasma, y un fantasma es peor que una ausencia.
    const filtro = soloCam ? `&cam=eq.${encodeURIComponent(soloCam)}` : "";
    const equipos = await sb(
      `gps_equipos?activo=eq.true&imei=not.is.null&select=cam,imei,placa${filtro}&order=cam`,
    );

    const resumen: any[] = [];
    let totalEnviadas = 0, totalFallidas = 0;

    for (const eq of equipos || []) {
      const est = await sb(
        `gps_reenvio_estado?cam=eq.${encodeURIComponent(eq.cam)}&select=enviado_hasta,enviadas_total`,
      );
      if (!est?.length) { resumen.push({ cam: eq.cam, error: "sin fila de cursor" }); continue; }
      const desde = est[0].enviado_hasta;

      const pos = await sb(
        `gps_posiciones?cam=eq.${encodeURIComponent(eq.cam)}&ts=gt.${encodeURIComponent(desde)}` +
        `&select=ts,lat,lon,velocidad,rumbo,id_equipo&order=ts.asc&limit=${tope}`,
      );
      if (!pos?.length) {
        // ⛔ EN `dry` NO SE ESCRIBE NI ESTO. Lo cazó la comprobación del primer
        // ensayo, 21/10: tres unidades sin nada pendiente quedaron con
        // `ultima_corrida` puesta por un ENSAYO. No movía el recorrido, pero
        // `ultima_corrida` es justo el campo con el que un vigilante decide si
        // el reenvío está vivo: un ensayo podía hacer pasar por sano a un
        // reenviador caído. Un ensayo que escribe deja de ser un ensayo.
        // [[norma-un-candado-que-vacia-una-columna-no-se-nota]]
        if (!dry) {
          await sb(`gps_reenvio_estado?cam=eq.${encodeURIComponent(eq.cam)}`, {
            method: "PATCH",
            body: JSON.stringify({ ultima_corrida: new Date().toISOString() }),
          });
        }
        resumen.push({ cam: eq.cam, pendientes: 0 });
        continue;
      }

      let ok = 0, ultimoOk: string | null = null, err: string | null = null;
      const porDia: Record<string, number> = {};
      let muestra: string | null = null;

      for (const p of pos) {
        const url = armarUrl(base, eq.imei, p);
        if (!muestra) muestra = dry ? url : url.replace(base, "<url>");
        try {
          if (!dry) await mandarUna(url);
          ok++;
          ultimoOk = p.ts;
          const d = diaVE(p.ts);
          porDia[d] = (porDia[d] || 0) + 1;
        } catch (e) {
          // REGLA 1: se corta acá. Lo que no salió se reintenta la próxima.
          err = String((e as Error).message).slice(0, 200);
          break;
        }
      }

      // El cursor avanza SOLO hasta lo que salió bien, y el contador del día se
      // suma, las dos cosas en UNA sola llamada (`gps_reenvio_anotar`). Van
      // juntas a propósito: si el cursor avanzara y el contador no, el cuadre
      // diría «faltan» para siempre sobre posiciones que sí salieron, y el
      // control que existe para probar la exactitud pasaría a desmentirla.
      // En `dry` no se anota nada: un ensayo que mueve el cursor se come el
      // recorrido de verdad.
      let anotado: unknown = null;
      if (!dry) {
        // ⛔ SIN `catch` QUE LO TAPE. Este contador ES la prueba de exactitud:
        // si no se pudo anotar, tiene que salir en la respuesta y no quedar en
        // un silencio que se lee como éxito.
        // [[norma-un-control-muerto-afirma-lo-que-no-hace]]
        anotado = await sb(`rpc/gps_reenvio_anotar`, {
          method: "POST",
          body: JSON.stringify({
            p_cam: eq.cam,
            p_hasta: ultimoOk,              // null si no salió ninguna
            p_por_dia: porDia,              // {"2026-10-21": 37}
            p_error: err,
          }),
        });
      }

      // REGLA 4: el IMEI que llegó contra el declarado.
      const otros = [...new Set((pos as any[]).map((p) => p.id_equipo).filter(Boolean))]
        .filter((i) => i !== eq.imei);

      totalEnviadas += ok;
      if (err) totalFallidas++;
      resumen.push({
        cam: eq.cam, imei: eq.imei, traidas: pos.length, enviadas: ok,
        hasta: ultimoOk, error: err,
        ...(anotado ? { anotado } : {}),
        ...(otros.length ? { ALERTA_imei_distinto: otros } : {}),
        ...(muestra ? { ejemplo: muestra } : {}),
      });
    }

    return json({
      ok: true,
      dry,
      unidades: (equipos || []).length,
      enviadas: totalEnviadas,
      unidades_con_error: totalFallidas,
      ms: Date.now() - t0,
      detalle: resumen,
      nota: dry
        ? "ENSAYO: no se mandó nada y el cursor no se movió"
        : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message).slice(0, 300) }, 500);
  }
});
