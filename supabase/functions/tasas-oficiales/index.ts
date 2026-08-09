// ══════════════════════════════════════════════════════════════════════════════
//  tasas-oficiales — RESCATADO del proyecto en producción el 2026-08-09.
//  Esta función estaba VIVA (v1, verify_jwt=false) y su código no existía
//  en ningún repositorio: si alguien la borraba, no había de dónde volver a sacarla.
//  Se bajó con GET /v1/projects/<ref>/functions/<slug>/body (viene en ESZIP; el fuente va
//  en texto plano adentro) y se extrajo tal cual, SIN retocarlo: lo que está acá es
//  exactamente lo que corre. Si hay que cambiar algo, cambiarlo y volver a desplegar.
// ══════════════════════════════════════════════════════════════════════════════
const URL = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (b, s = 200)=>new Response(JSON.stringify(b), {
    status: s,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  try {
    const r = await fetch(`${URL}/rest/v1/tasas_diarias?select=fecha,bcv_dolar,bcv_euro,binance,fuente&order=fecha.desc&limit=20`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`
      }
    });
    if (!r.ok) return json({
      ok: false,
      error: "no se pudo leer tasas"
    }, 200);
    const rows = await r.json();
    const num = (v)=>{
      const n = parseFloat(v);
      return isFinite(n) && n > 0 ? n : null;
    };
    // dÃ³lar/binance: la fila mÃ¡s reciente con dÃ³lar vÃ¡lido
    const dRow = rows.find((x)=>num(x.bcv_dolar)) || {};
    // euro: la fila mÃ¡s reciente con euro VÃLIDO (euro > dÃ³lar). Nunca un euro roto.
    const eRow = rows.find((x)=>num(x.bcv_euro) && num(x.bcv_dolar) && Number(x.bcv_euro) > Number(x.bcv_dolar)) || {};
    return json({
      ok: true,
      fecha: dRow.fecha || null,
      bcv_dolar: num(dRow.bcv_dolar),
      binance: num(dRow.binance),
      bcv_euro: num(eRow.bcv_euro),
      euro_fecha: eRow.fecha || null,
      euro_fuente: eRow.fuente || null,
      fuente: dRow.fuente || null
    });
  } catch (e) {
    return json({
      ok: false,
      error: String(e)
    }, 200);
  }
});