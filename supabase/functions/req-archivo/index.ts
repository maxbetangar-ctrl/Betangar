import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DEL PROVEEDOR, FIRMADO — para que lo vea QUIEN FIRMA
//
// 🔴 POR QUÉ EXISTE (19/09/2026). Alejandra, SOP-20260908-7TYY punto 3a:
//    *«Requisitorios: permitir cargar imagen de presupuestos emitidos por el proveedor, y que
//     quede la opción para verlo»*.
//
//    Quien decide es justo el que NO tiene sesión: `aprobar.html` abre con `?t=<token>` y
//    llama a `req_ver`. El presupuesto vive en el bucket `documentos`, que es privado, así
//    que sin esta función el que firma vería la oferta y no el papel que la sostiene — que
//    es exactamente lo que pidió poder mirar antes de aprobar.
//
// ⛔ LAS TRES REGLAS, LAS MISMAS QUE `entrega-foto`:
//  1. **LA RUTA NO VIAJA DESDE EL NAVEGADOR.** Entran el token y el id de la cotización. La
//     ruta sale de la fila. Si el cliente pudiera mandarla, esto firmaría cualquier archivo
//     del bucket para cualquiera — y ahí viven documentos de empleados.
//  2. **LA COTIZACIÓN TIENE QUE SER DE LA REQUISICIÓN DE ESE TOKEN.** No alcanza con que el
//     id exista: se comprueba el vínculo. Sin eso, quien tiene UN token válido podría pedir
//     los presupuestos de todas las demás requisiciones probando ids.
//  3. **UN TOKEN QUE NO EXISTE NO DICE NADA.** El mismo 404 que una cotización sin archivo.
//
// ⚠️ `req_ver` le dice a la pantalla si hay archivo con un BOOLEANO (`tiene_archivo`), nunca
//    con la ruta. Esta función es el único camino hasta el archivo.
//
// Entrada:  POST { "token": "...", "cotizacion_id": "RQ…_C1" }
// Salida:   { ok: true, url: "https://…" }  |  { ok: false, motivo: "..." }
// verify_jwt = FALSE, obligatorio: la llama quien firma, sin cuenta. Declarado en
// `supabase/config.toml` — si no está ahí, el próximo deploy lo pone en true y el botón deja
// de funcionar EN SILENCIO. [[norma-verify-jwt-se-conserva-no-se-impone]]
// ════════════════════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// El bucket no se recibe por parámetro: si se pudiera elegir, esto firmaría cualquiera.
const BUCKET = "documentos";
const VIGENCIA_SEG = 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// De lo guardado a la ruta. Hoy se guarda la RUTA pelada; se toleran las otras dos formas
// por si alguna fila vieja quedó con una URL. Devuelve "" si no reconoce nada: mejor sin
// archivo que firmando una ruta adivinada.
function rutaDe(guardado: string): string {
  const s = String(guardado || "").trim();
  if (!s) return "";
  for (const sep of [`/object/public/${BUCKET}/`, `/object/sign/${BUCKET}/`]) {
    const p = s.split(sep)[1];
    if (p) return decodeURIComponent(p.split("?")[0]);
  }
  if (s.startsWith("http")) return "";
  return s.replace(new RegExp(`^${BUCKET}/`), "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, motivo: "POST" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }
  const token = String(body?.token ?? "").trim();
  const cotId = String(body?.cotizacion_id ?? "").trim();
  if (!token || token.length > 120 || !cotId || cotId.length > 120) {
    return json({ ok: false, motivo: "faltan datos" }, 400);
  }

  // ── LA REQUISICIÓN QUE ESE TOKEN IDENTIFICA ───────────────────────────────
  let reqId = "";
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/requisiciones?token=eq.${encodeURIComponent(token)}&select=id&limit=1`,
      { headers: HDR },
    );
    if (!r.ok) return json({ ok: false, motivo: "no se pudo consultar" }, 502);
    reqId = (await r.json())?.[0]?.id ?? "";
  } catch { return json({ ok: false, motivo: "no se pudo consultar" }, 502); }
  if (!reqId) return json({ ok: false, motivo: "sin archivo" }, 404);

  // ── Y LA COTIZACIÓN, PERO SOLO SI ES DE ESA REQUISICIÓN ───────────────────
  // El `req_id=eq.` es la regla, no un filtro de comodidad: sin él, un token válido
  // abriría los presupuestos de todas las demás requisiciones.
  let guardado = "";
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/req_cotizaciones?id=eq.${encodeURIComponent(cotId)}` +
      `&req_id=eq.${encodeURIComponent(reqId)}&select=archivo_url&limit=1`,
      { headers: HDR },
    );
    if (!r.ok) return json({ ok: false, motivo: "no se pudo consultar" }, 502);
    guardado = (await r.json())?.[0]?.archivo_url ?? "";
  } catch { return json({ ok: false, motivo: "no se pudo consultar" }, 502); }

  const ruta = rutaDe(guardado);
  if (!ruta) return json({ ok: false, motivo: "sin archivo" }, 404);

  // ── LA FIRMA ──────────────────────────────────────────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodeURI(ruta)}`, {
      method: "POST",
      headers: { ...HDR, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: VIGENCIA_SEG }),
    });
    if (!r.ok) {
      console.error("firmar", r.status, (await r.text()).slice(0, 200));
      return json({ ok: false, motivo: "no se pudo abrir" }, 502);
    }
    const d = await r.json();
    const rel = String(d?.signedURL ?? d?.signedUrl ?? "");
    if (!rel) return json({ ok: false, motivo: "no se pudo abrir" }, 502);
    return json({ ok: true, url: `${SUPABASE_URL}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}` });
  } catch (e) {
    console.error("firmar exc", String(e));
    return json({ ok: false, motivo: "no se pudo abrir" }, 502);
  }
});
