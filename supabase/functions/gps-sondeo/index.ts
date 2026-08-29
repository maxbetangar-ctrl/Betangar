// ══════════════════════════════════════════════════════════════════════════════
//  gps-sondeo — trae la posición de las unidades desde el API de Foresight GPS
//               y las guarda en `gps_posiciones`.
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
//  🥇 UNA SOLA PETICIÓN TRAE TODA LA CUENTA — medido el 29/08/2026
//  Omitiendo `plateno`, el API contesta `responseCode 100` con TODAS las unidades
//  de la cuenta (10 el día de la medición). Ése es ahora el camino principal.
//
//  Esto tumba el cálculo que trancaba el diseño desde el 15/08: se creía que con
//  1 petición por unidad y el tope de 10 pet/min, una vuelta a 60 unidades tardaba
//  6 MINUTOS — y a 6 minutos por vuelta el camión salta cuadras enteras y las
//  paradas de recolección desaparecen, que es justo lo que se le muestra a la
//  Alcaldía para probar que se detuvo a recoger. Con la petición única no hay piso:
//  el límite pasa a ser cada cuánto reporta el equipo (~1 min), no cuántas veces
//  podemos preguntar.
//
//  ⚠️ La lista de placas separadas por coma SIGUE sin funcionar, y AHORA sí está
//  probado: el 15/08 dio vacío pero el demo daba acceso a una sola placa, así que
//  el vacío era la respuesta correcta a pedir una placa ajena. El 29/08 se repitió
//  con DOS placas que sí responden por separado — la lista sigue dando conjunto
//  vacío. Lo que sirve es omitir el parámetro, no enumerar.
//
//  🔴 EL PROVEEDOR NOMBRA UNA UNIDAD DISTINTO QUE NOSOTROS
//  JAC-B008: la placa del camión es `A04EO1P` y el API la llama `AO4E01P` (la O y
//  el 0 cambiados). Con la nuestra contesta vacío. Por eso el casamiento va por
//  `gps_equipos.placa_proveedor` cuando existe, y NO por una normalización que
//  "arregle" la cadena en silencio: eso afirmaría que dos placas distintas son la
//  misma y el día que dos colisionen, el camión queda cambiado sin que se note.
//  Lo que el API manda y no casa con NADIE se reporta y no se guarda: no se
//  inventan camiones.
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
//
//  MODOS (body JSON, opcional):
//    {}                  → petición única (camino normal)
//    {"modo":"placa"}    → una petición por unidad activa, el camino viejo. Queda
//                          como respaldo EJERCITABLE: un respaldo que nunca se
//                          corre no se sabe si funciona. Úsalo si el proveedor
//                          rompe la petición única.
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

const PAUSA_MS = Number(Deno.env.get("GPS_PAUSA_MS") || 6000);  // solo el modo placa
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

/**
 * Una llamada al API. Sin `placa` pide TODA la cuenta; con `placa` pide una.
 * Devuelve SIEMPRE un arreglo (vacío si el conjunto vino vacío) o lanza.
 */
async function pedirEstado(placa?: string): Promise<any[]> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), PLAZO_MS);
  try {
    const cuerpo: Record<string, unknown> = {
      method: "GetCurrentUnitsStatus",
      conncode: GPS_CONN,
      wsuser: GPS_WSU,
      wspassword: GPS_WSP,
    };
    if (placa) cuerpo.plateno = placa;

    const r = await fetch(GPS_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${GPS_USER}:${GPS_PASS}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);

    let j: any;
    try { j = JSON.parse(txt); }
    catch { throw new Error(`respuesta no es JSON: ${txt.slice(0, 200)}`); }

    // 100 = hay datos · 200 = conjunto vacío · -500 = error del proveedor
    if (j?.responseCode === 200) return [];
    if (j?.responseCode !== 100) {
      const err = j?.ForesightFlexAPI?.ForesightFlexAPI?.error || `responseCode ${j?.responseCode}`;
      throw new Error(String(err).slice(0, 300));
    }
    const d = j?.ForesightFlexAPI?.DATA;
    return Array.isArray(d) ? d : (d ? [d] : []);
  } finally {
    clearTimeout(reloj);
  }
}

/** Número válido o null. Nunca convierte un 0 de sensor ausente en dato. */
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Cómo nombra el API a esta unidad: la del proveedor si difiere, si no la real. */
const placaApi = (eq: any) => String(eq.placa_proveedor || eq.placa || "").trim().toUpperCase();

/** Guarda una lectura. Devuelve la línea de resumen. */
async function guardar(eq: any, d: any) {
  const linea: any = { cam: eq.cam, placa: eq.placa };
  const ahora = new Date().toISOString();

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
  return linea;
}

/** Deja escrito el problema de una unidad. Un hueco no se ve; un error sí. */
async function marcarProblema(cam: string, error: string) {
  await fetch(`${URL_SB}/rest/v1/gps_sync_estado?on_conflict=cam`, {
    method: "POST",
    headers: { ...cabSb, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      cam, ultima_corrida: new Date().toISOString(), ultimo_error: error.slice(0, 300),
    }),
  });
}

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

  const body = await req.json().catch(() => ({}));
  const modo: string = body?.modo === "placa" ? "placa" : "cuenta";

  const t0 = Date.now();
  const resumen: any[] = [];

  // 1. A quién se le pregunta / a quién se le acepta el dato.
  const rEq = await fetch(
    `${URL_SB}/rest/v1/gps_equipos?select=id_equipo,cam,placa,placa_proveedor&activo=is.true&order=cam`,
    { headers: cabSb },
  );
  if (!rEq.ok) return json({ ok: false, error: "no se pudo leer gps_equipos: " + (await rEq.text()).slice(0, 200) }, 500);
  const equipos: any[] = await rEq.json();
  if (!equipos.length) return json({ ok: true, aviso: "no hay unidades activas en gps_equipos", unidades: 0 });

  // Índice por la cadena con la que el API nombra a cada unidad.
  const porPlaca = new Map<string, any>();
  for (const eq of equipos) porPlaca.set(placaApi(eq), eq);

  const ajenas: string[] = [];
  const sinNoticia: string[] = [];

  if (modo === "cuenta") {
    // ─── Camino normal: UNA petición para toda la flota ───────────────────────
    let datos: any[];
    try {
      datos = await pedirEstado();
    } catch (e) {
      // Falla la cuenta entera: se marca a TODAS, porque de todas quedamos sin saber.
      const err = "petición única: " + String(e).slice(0, 250);
      for (const eq of equipos) await marcarProblema(eq.cam, err);
      return json({ ok: false, modo, error: err, unidades: equipos.length }, 502);
    }

    const vistas = new Set<string>();
    for (const d of datos) {
      const placa = String(d?.PlateNo ?? d?.plateno ?? "").trim().toUpperCase();
      const eq = porPlaca.get(placa);
      if (!eq) {
        // Vino una unidad que no está en gps_equipos (o está inactiva). Se reporta
        // y NO se guarda: un camión que el sistema no conoce no se inventa acá.
        ajenas.push(placa || "(sin placa)");
        continue;
      }
      vistas.add(eq.cam);
      try {
        resumen.push(await guardar(eq, d));
      } catch (e) {
        const err = String(e).slice(0, 300);
        resumen.push({ cam: eq.cam, placa: eq.placa, error: err });
        await marcarProblema(eq.cam, err);
      }
    }

    // Una unidad activa que NO vino en el listado es una ausencia, y una ausencia
    // se ve igual que todo en orden si no se escribe.
    for (const eq of equipos) {
      if (!vistas.has(eq.cam)) {
        sinNoticia.push(eq.cam);
        await marcarProblema(eq.cam, "no vino en el listado de la cuenta (¿el proveedor le quitó el acceso?)");
      }
    }
  } else {
    // ─── Respaldo ejercitable: una petición por unidad (el camino de agosto) ───
    for (let i = 0; i < equipos.length; i++) {
      const eq = equipos[i];
      try {
        const datos = await pedirEstado(placaApi(eq));
        if (!datos.length) {
          resumen.push({ cam: eq.cam, placa: eq.placa, estado: "conjunto vacío: sin acceso a la placa" });
          await marcarProblema(eq.cam, "conjunto vacío: sin acceso a la placa");
        } else {
          resumen.push(await guardar(eq, datos[0]));
        }
      } catch (e) {
        const err = String(e).slice(0, 300);
        resumen.push({ cam: eq.cam, placa: eq.placa, error: err });
        await marcarProblema(eq.cam, err);
      }
      if (i < equipos.length - 1) await dormir(PAUSA_MS);   // respetar 10 pet/min
    }
  }

  return json({
    ok: true,
    modo,
    unidades: equipos.length,
    guardadas: resumen.filter((x) => x.guardado).length,
    con_error: resumen.filter((x) => x.error).length,
    sin_noticia: sinNoticia,          // activas que el proveedor no mandó
    placas_ajenas: ajenas,            // que mandó y no tenemos registradas
    segundos: Math.round((Date.now() - t0) / 1000),
    detalle: resumen,
  });
});
