// ══════════════════════════════════════════════════════════════════════════════
//  gps-diagnostico — SOLO LECTURA contra el API de Foresight. No escribe nada.
//
//  Existe para contestar LA pregunta que decide la arquitectura del sondeo y que
//  no se pudo contestar el 15/08: ¿UNA petición puede traer VARIAS placas?
//  Aquella prueba dio "conjunto vacío" con dos placas, pero el demo daba acceso a
//  UNA sola: el vacío era la respuesta correcta a pedir una placa ajena. No
//  distinguía «no acepta lista» de «no tenés esa placa».
//  Con acceso a las 12 (29/08/2026) la prueba por fin mide lo que dice.
//
//  Con 60 unidades y 1 petición por unidad (tope 10 pet/min) una vuelta tarda
//  6 MINUTOS y las paradas de recolección desaparecen. Si acepta lista, no hay piso.
// ══════════════════════════════════════════════════════════════════════════════

const GPS_URL  = Deno.env.get("GPS_API_URL") || "http://flexapi.foresightgps.com/ForesightFlexAPIv3.ashx";
const GPS_USER = Deno.env.get("GPS_BASIC_USER") || "";
const GPS_PASS = Deno.env.get("GPS_BASIC_PASS") || "";
const GPS_CONN = Deno.env.get("GPS_CONNCODE") || "";
const GPS_WSU  = Deno.env.get("GPS_WSUSER") || "";
const GPS_WSP  = Deno.env.get("GPS_WSPASSWORD") || "";
const CLAVE    = Deno.env.get("GPS_CRON_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una llamada cruda. Devuelve lo justo para comparar, sin interpretar. */
async function llamar(cuerpoExtra: Record<string, unknown>) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 25000);
  const t0 = Date.now();
  try {
    const r = await fetch(GPS_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${GPS_USER}:${GPS_PASS}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "GetCurrentUnitsStatus",
        conncode: GPS_CONN, wsuser: GPS_WSU, wspassword: GPS_WSP,
        ...cuerpoExtra,
      }),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j: any = null;
    try { j = JSON.parse(txt); } catch { /* se reporta el crudo */ }
    const data = j?.ForesightFlexAPI?.DATA;
    return {
      http: r.status,
      responseCode: j?.responseCode ?? null,
      // 100 = hay datos · 200 = conjunto vacío · -500 = error
      registros: Array.isArray(data) ? data.length : (data ? 1 : 0),
      placas: Array.isArray(data)
        ? data.map((d: any) => ({
            placa: d?.PlateNo ?? d?.plateno ?? null,
            unidad: d?.UnitName ?? d?.TObjectName ?? null,
            reporte: d?.LastReported ?? null,
            odometro: d?.Odometer ?? null,
            ignicion: d?.Ignition ?? null,
            valido: d?.ValidGPS ?? null,
          }))
        : [],
      error: j?.ForesightFlexAPI?.ForesightFlexAPI?.error ?? null,
      crudo: j ? null : txt.slice(0, 300),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { error_local: String(e).slice(0, 300), ms: Date.now() - t0 };
  } finally { clearTimeout(reloj); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (CLAVE && (req.headers.get("x-api-key") || "") !== CLAVE) {
    return json({ ok: false, error: "no autorizado" }, 401);
  }
  if (!GPS_USER || !GPS_PASS || !GPS_CONN || !GPS_WSU || !GPS_WSP) {
    return json({ ok: false, error: "faltan secretos del proveedor GPS" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const placas: string[] = Array.isArray(body.placas) ? body.placas : [];
  const pruebas: Record<string, unknown> = {};

  if (placas.length) {
    // Modo "una por una": sirve para distinguir «no está en la cuenta» de
    // «el listado la omite por un tope de registros». Son dos causas distintas
    // con consecuencias opuestas para el techo de 60 unidades.
    for (let i = 0; i < placas.length; i++) {
      pruebas["sola_" + placas[i]] = await llamar({ plateno: placas[i] });
      if (i < placas.length - 1) await dormir(6500);
    }
    return json({ ok: true, nota: "solo lectura", pruebas });
  }

  const a: string = body.a || "A20EP8P";              // la que YA sabemos que funciona
  const b: string = body.b || "A06ER7P";              // otra cualquiera (JAC-B001)
  const sep: string = body.sep || ",";

  // 1. Control positivo: la placa que sabemos que responde.
  pruebas["1_control_" + a] = await llamar({ plateno: a });
  await dormir(6500);

  // 2. ¿Ya tenemos acceso a la segunda placa? (esto es lo que cambió hoy)
  pruebas["2_segunda_" + b] = await llamar({ plateno: b });
  await dormir(6500);

  // 3. LA PRUEBA: las dos juntas, separadas por el separador pedido.
  pruebas["3_lista_" + a + sep + b] = await llamar({ plateno: a + sep + b });
  await dormir(6500);

  // 4. Sin `plateno`: ¿devuelve TODA la cuenta? Sería lo mejor posible.
  pruebas["4_sin_plateno"] = await llamar({});
  await dormir(6500);

  // 5. `plateno` vacío, por si el handler lo trata distinto a ausente.
  pruebas["5_plateno_vacio"] = await llamar({ plateno: "" });

  return json({ ok: true, nota: "solo lectura: no se escribió nada en la base", pruebas });
});
