// ══════════════════════════════════════════════════════════════════════════════
//  gps-sondeo — trae la posición de cada unidad desde el API de Foresight GPS
//               y la guarda en `gps_posiciones`.
//
//  POR QUÉ ES UN SONDEADOR Y NO UN DESCARGADOR (14/08/2026)
//  El API del proveedor expone UN SOLO método: `GetCurrentUnitsStatus`, que
//  devuelve el estado ACTUAL y no acepta rango de fechas. Se probaron 31 nombres
//  de operación candidatos (historial, eventos, viajes, paradas, geocercas...) y
//  NINGUNO existe: el handler responde
//  "Could not find stored procedure 'FSSP_API_<method>'".
//  ⛔ Consecuencia: los 90 días de historial que guarda el proveedor NO se pueden
//  bajar. El historial se construye acá, desde el primer sondeo. Cada hora que
//  esta función no corre es un pedazo de recorrido que no va a existir nunca.
//
//  ⚠️ «1 PETICIÓN = 1 UNIDAD» ESTÁ SIN COMPROBAR — LA PRUEBA QUE LO AFIRMABA NO SERVÍA.
//  Acá decía: «Probado `plateno` con dos placas separadas por coma: devuelve conjunto
//  vacío. Por eso se recorre unidad por unidad.» Máximo lo corrigió el 15/08: el demo
//  da acceso a UNA SOLA PLACA (`JAC-B010`). Pedir dos y recibir vacío es exactamente lo
//  que la API debe contestar cuando una de las dos no es tuya — la prueba NO distingue
//  «no acepta varias placas» de «no tenés esa placa», y se sacó la primera conclusión.
//
//  Se recorre unidad por unidad porque hoy hay una sola, no porque esté probado que no
//  se pueda de otra forma. ⛔ CUANDO LLEGUEN LAS 12 PLACAS DEFINITIVAS, LO PRIMERO ES
//  REPETIR LA PRUEBA con dos placas que SÍ tengan acceso. Si acepta la lista, todo el
//  cálculo de abajo se cae y el sondeo pasa a ser una petición para toda la flota.
//
//  LÍMITE DEL PROVEEDOR: 10 peticiones/minuto (no bloquea, hace esperar). SI hay que ir
//  de a una, con 12 unidades y 6 s entre llamadas el ciclo tarda ~72 s (6 pet/min), y
//  ese ~72 s pasa a ser el PISO de resolución del mapa. Si acepta varias placas, no hay
//  piso: se puede sondear tan seguido como el equipo reporte.
//  Hoy solo `JAC-B010` tiene acceso (demo, vence 24/08) y el resto está `activo=false`
//  en `gps_equipos`: el flag decide a quién se le pregunta, así no se gastan 11
//  peticiones inútiles cada 2 minutos.
//
//  ⚠️ Y CON UNA SOLA UNIDAD, LAS 10 PET/MIN SOBRAN: se la puede sondear cada 6-10 s en
//  vez de cada 2 minutos. El mapa de hoy va 12 veces más lento de lo que ya se podría.
//
//  ⚠️ EL API DEVUELVE EL ÚLTIMO DATO CONOCIDO COMO SI FUERA EL ACTUAL.
//  Medido el 14/08: dos consultas separadas 21 minutos trajeron el mismo
//  `LastReported` (14:03:29), con `Ignition:true` y `Speed:45`. O sea: el camión
//  NO iba a 45 en ese momento — así iba la última vez que el equipo reportó.
//  Por eso lo que manda es `LastReported`, no la hora en que preguntamos, y por
//  eso `gps_sync_estado.bajado_hasta` guarda hasta cuándo sabemos de verdad.
//
//  ⚠️ CAMPOS QUE LLEGAN EN CERO Y NO SON UN DATO: EngineTemp, FuelLevelPercent,
//  BatteryLevel, Temp1/2, HorometerMin, TripOdometer, AnalogIn1/2. Con el motor
//  encendido, temperatura 0 y batería 0 son imposibles: son sensores que no están
//  instalados. NO se guardan. Guardar un 0 ahí sería inventar una lectura.
//
//  ⚠️ EL API ES HTTP PLANO (sin TLS) y la clave viaja en Base64 en cada llamada.
//  Por eso la llamada sale de acá, del servidor, y NUNCA del navegador: en el
//  bundle la vería cualquiera que abra el inspector.
// ══════════════════════════════════════════════════════════════════════════════

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const KEY_SB = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Credenciales del proveedor: viven en los secretos de la función, nunca en el repo.
const GPS_URL  = Deno.env.get("GPS_API_URL") || "http://flexapi.foresightgps.com/ForesightFlexAPIv3.ashx";
const GPS_USER = Deno.env.get("GPS_BASIC_USER") || "";
const GPS_PASS = Deno.env.get("GPS_BASIC_PASS") || "";
const GPS_CONN = Deno.env.get("GPS_CONNCODE") || "";
const GPS_WSU  = Deno.env.get("GPS_WSUSER") || "";
const GPS_WSP  = Deno.env.get("GPS_WSPASSWORD") || "";
const CLAVE    = Deno.env.get("GPS_CRON_KEY") || "";

// Venezuela es UTC-4 fijo. El proveedor manda la hora local SIN zona
// ("2026-08-14T14:03:29"); si se pasa así a Postgres, la lee como UTC y el día
// entero queda corrido 4 horas. Ver la norma: la hora es la del NEGOCIO.
const TZ_VE = "-04:00";

const PAUSA_MS = Number(Deno.env.get("GPS_PAUSA_MS") || 6000);
const PLAZO_MS = 20000;   // una llamada sin plazo cuelga la corrida entera

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cabSb = {
  apikey: KEY_SB,
  Authorization: `Bearer ${KEY_SB}`,
  "Content-Type": "application/json",
};

/** Pide el estado actual de UNA unidad. Devuelve el objeto crudo o lanza. */
async function pedirEstado(placa: string) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), PLAZO_MS);
  try {
    const r = await fetch(GPS_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${GPS_USER}:${GPS_PASS}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "GetCurrentUnitsStatus",
        conncode: GPS_CONN,
        wsuser: GPS_WSU,
        wspassword: GPS_WSP,
        plateno: placa,
      }),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);

    let j: any;
    try { j = JSON.parse(txt); }
    catch { throw new Error(`respuesta no es JSON: ${txt.slice(0, 200)}`); }

    // 100 = hay datos · 200 = conjunto vacío · -500 = error del proveedor
    if (j?.responseCode === 200) return null;               // sin acceso o placa sin equipo
    if (j?.responseCode !== 100) {
      const err = j?.ForesightFlexAPI?.ForesightFlexAPI?.error || `responseCode ${j?.responseCode}`;
      throw new Error(String(err).slice(0, 300));
    }
    return j?.ForesightFlexAPI?.DATA?.[0] ?? null;
  } finally {
    clearTimeout(reloj);
  }
}

/** Número válido o null. Nunca convierte un 0 de sensor ausente en dato. */
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Candado: solo el cron (o quien tenga la clave) puede disparar el sondeo.
  if (CLAVE && (req.headers.get("x-api-key") || "") !== CLAVE) {
    return json({ ok: false, error: "no autorizado" }, 401);
  }
  if (!GPS_USER || !GPS_PASS || !GPS_CONN || !GPS_WSU || !GPS_WSP) {
    // Que la pieza compruebe sus herramientas al arrancar y avise si le faltan,
    // en vez de fallar en silencio contra el proveedor.
    return json({ ok: false, error: "faltan secretos del proveedor GPS (GPS_BASIC_USER/PASS, GPS_CONNCODE, GPS_WSUSER, GPS_WSPASSWORD)" }, 500);
  }

  const t0 = Date.now();
  const resumen: any[] = [];

  // 1. A quién se le pregunta
  const rEq = await fetch(
    `${URL_SB}/rest/v1/gps_equipos?select=id_equipo,cam,placa&activo=is.true&order=cam`,
    { headers: cabSb },
  );
  if (!rEq.ok) return json({ ok: false, error: "no se pudo leer gps_equipos: " + (await rEq.text()).slice(0, 200) }, 500);
  const equipos = await rEq.json();
  if (!equipos.length) return json({ ok: true, aviso: "no hay unidades activas en gps_equipos", unidades: 0 });

  // 2. Unidad por unidad (1 petición = 1 unidad)
  for (let i = 0; i < equipos.length; i++) {
    const eq = equipos[i];
    const linea: any = { cam: eq.cam, placa: eq.placa };
    const ahora = new Date().toISOString();

    try {
      const d = await pedirEstado(eq.placa);

      if (!d) {
        linea.estado = "sin datos (el proveedor no da acceso a esta placa)";
        await fetch(`${URL_SB}/rest/v1/gps_sync_estado?on_conflict=cam`, {
          method: "POST",
          headers: { ...cabSb, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            cam: eq.cam, ultima_corrida: ahora,
            ultimo_error: "conjunto vacío: sin acceso a la placa",
          }),
        });
      } else {
        // La hora del reporte manda; la hora en que preguntamos no significa nada.
        const crudo = String(d.LastReported || d.LastTime || "").trim();
        if (!crudo) throw new Error("el proveedor no mandó LastReported");
        const ts = new Date(crudo + TZ_VE);
        if (isNaN(ts.getTime())) throw new Error(`LastReported ilegible: ${crudo}`);

        const lat = num(d.yLat), lon = num(d.xLong);
        const posValida = d.ValidGPS === true && lat !== null && lon !== null &&
                          Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

        linea.ultimo_reporte = ts.toISOString();
        linea.antiguedad_min = Math.round((Date.now() - ts.getTime()) / 60000);

        if (posValida) {
          // ignore-duplicates: si el equipo no reportó nada nuevo desde el sondeo
          // anterior, la llave única (cam, ts) descarta la fila sin error. Es lo
          // que hace idempotente al sondeador y evita duplicar el día.
          const rIns = await fetch(
            `${URL_SB}/rest/v1/gps_posiciones?on_conflict=cam,ts`,
            {
              method: "POST",
              headers: { ...cabSb, Prefer: "resolution=ignore-duplicates,return=representation" },
              body: JSON.stringify([{
                cam: eq.cam,
                ts: ts.toISOString(),
                lat, lon,
                velocidad: num(d.Speed),
                rumbo: num(d.Course),
                // Ignition sí es real. Los demás sensores llegan en 0 y no se guardan.
                ignicion: typeof d.Ignition === "boolean" ? d.Ignition : null,
                odometro: num(d.Odometer),
                // La dirección viene YA geocodificada del proveedor y sin costo: es
                // justo el servicio caro de un mapa comercial. Se guarda porque hace
                // legible un recorrido sin depender de que alguien mire el mapa.
                // El proveedor le pega un sufijo "~Zulia" que es ruido: se corta.
                ubicacion: String(d.Location || "").split("~")[0].trim() || null,
                id_equipo: String(d.IMEI || d.SerialNumber || eq.id_equipo || ""),
              }]),
            },
          );
          if (!rIns.ok) throw new Error("insert: " + (await rIns.text()).slice(0, 200));
          const filas = await rIns.json();
          linea.guardado = filas.length > 0;   // false = ya lo teníamos (no reportó nada nuevo)
          linea.odometro = num(d.Odometer);
          linea.ignicion = d.Ignition;
        } else {
          linea.guardado = false;
          linea.estado = "posición inválida (ValidGPS false o coordenada nula): no se guarda";
        }

        await fetch(`${URL_SB}/rest/v1/gps_sync_estado?on_conflict=cam`, {
          method: "POST",
          headers: { ...cabSb, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({
            cam: eq.cam,
            bajado_hasta: ts.toISOString(),
            ultima_corrida: ahora,
            ultimo_ok: ahora,
            ultimo_error: null,
            intentos_fallidos: 0,
          }),
        });
      }
    } catch (e) {
      // El error se GUARDA y se devuelve. Un catch vacío convierte un fallo en un
      // hueco, y un hueco no se ve: eso ya costó meses con las fotos de entrega.
      linea.error = String(e).slice(0, 300);
      await fetch(`${URL_SB}/rest/v1/gps_sync_estado?on_conflict=cam`, {
        method: "POST",
        headers: { ...cabSb, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ cam: eq.cam, ultima_corrida: ahora, ultimo_error: linea.error }),
      });
    }

    resumen.push(linea);
    if (i < equipos.length - 1) await dormir(PAUSA_MS);   // respetar 10 pet/min
  }

  return json({
    ok: true,
    unidades: equipos.length,
    guardadas: resumen.filter((x) => x.guardado).length,
    con_error: resumen.filter((x) => x.error).length,
    segundos: Math.round((Date.now() - t0) / 1000),
    detalle: resumen,
  });
});
