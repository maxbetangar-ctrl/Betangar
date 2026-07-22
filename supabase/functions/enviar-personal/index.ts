// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIAR A TODO EL PERSONAL — comunicado que SOLO sale a los contactos "calientes".
//
// Pedido de Máximo (2026-07-21): un boton fijo para avisarle a todo el personal, que mande SOLO a los
// que ya pueden recibir, sin arriesgar el numero. WhatsApp bloquea escribirle EN FRIO a quien nunca
// le escribio al numero; blastear a muchos frios puede BANEAR el numero del que dependen las 4 apps.
//
// "Caliente" = ya le escribio al numero alguna vez. Fuente: `wa_autoreply_log` (lo llena la
// auto-bienvenida en cada primer mensaje entrante, de las 2 empresas) + el roster de
// configuracion.whatsapp (socios/admin/etc, siempre en contacto).
//
// Los FRIOS NO se les envia: se devuelven en la respuesta (nombre) para que RRHH los caliente.
// Encola en cola_mensajes con el saludo por hora; el worker antepone la etiqueta de la empresa.
//
// POST { empresa:'bet'|'flot', mensaje:'...', roles?:['socios',...], forzar_todos?:false }
//   forzar_todos=true ignora el filtro de calientes (usar solo cuando se sabe que todos escribieron).
//   ?dry=1 arma y devuelve a quien iria SIN encolar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const BET_URL = Deno.env.get("SUPABASE_URL")!;
const BET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLOT_URL = Deno.env.get("FLOT_URL")!;
const FLOT_KEY = Deno.env.get("FLOT_SERVICE_KEY")!;
const SECRET = Deno.env.get("AUTOREPLY_SECRET") || "";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const H = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });
const p10 = (s: string) => String(s || "").replace(/\D/g, "").slice(-10);
const norm = (s: string) => { let d = String(s || "").replace(/\D/g, ""); if (d.startsWith("580")) d = "58" + d.slice(3); if (d.startsWith("58")) return "+" + d; if (d.startsWith("0")) return "+58" + d.slice(1); if (d.length === 10) return "+58" + d; return "+" + d; };

function saludo(): string {
  const h = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Caracas", hour: "2-digit", hour12: false }), 10) || 0;
  return h < 12 ? "Buenos dias" : (h < 19 ? "Buenas tardes" : "Buenas noches");
}
async function sel(url: string, key: string, path: string) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: H(key) });
  if (!r.ok) { console.error("sel", path, r.status); return []; }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const body = await req.json().catch(() => ({}));
    const empresa = (body.empresa === "flot") ? "flot" : "bet";
    const _tUrl0 = empresa === "bet" ? BET_URL : FLOT_URL;
    // AUTORIZACION: el secreto (yo/cron) O un usuario logueado ADMIN de la app. Sin esto, el numero
    // del que dependen las 4 apps quedaria a merced de cualquiera con la URL. El secreto NO viaja al
    // navegador: el boton de la app manda el token del usuario, y aca se verifica su rol.
    let autorizado = (SECRET && url.searchParams.get("key") === SECRET);
    if (!autorizado) {
      const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const sub = subDeJWT(auth);   // id del usuario logueado, del token
      if (sub) {
        try {
          // Se busca por auth_user_id con service_role (sin depender del RLS de btg_usuarios).
          const tKey0 = empresa === "bet" ? BET_KEY : FLOT_KEY;
          const r = await fetch(`${_tUrl0}/rest/v1/btg_usuarios?auth_user_id=eq.${encodeURIComponent(sub)}&select=rol`, { headers: H(tKey0) });
          const rows = r.ok ? await r.json() : [];
          const rol = rows && rows[0] ? String(rows[0].rol || "") : "";
          if (["superadmin", "admin"].includes(rol)) autorizado = true;
        } catch { /* no autoriza */ }
      }
    }
    if (!autorizado) return json({ ok: false, error: "solo un administrador puede enviar comunicados" }, 401);
    const mensaje = String(body.mensaje || "").trim();
    const roles = Array.isArray(body.roles) ? body.roles : null;   // null = todos los cargos
    const forzar = body.forzar_todos === true;
    if (!mensaje) return json({ ok: false, error: "falta el mensaje" }, 400);

    const tUrl = empresa === "bet" ? BET_URL : FLOT_URL;
    const tKey = empresa === "bet" ? BET_KEY : FLOT_KEY;
    const empNombre = empresa === "bet" ? "Inversiones Betangar C.A." : "FLOTILLA S.A.";

    // Empleados activos con telefono (del que corresponda a esa empresa).
    const emps = await sel(tUrl, tKey, "empleados?select=nombre,cargo,whatsapp,tel,activo");
    // CALIENTES: los que ya escribieron (wa_autoreply_log vive en Betangar, con las 2 empresas)
    const logRows = await sel(BET_URL, BET_KEY, `wa_autoreply_log?select=telefono&empresa=eq.${encodeURIComponent(empNombre)}`);
    const calientes = new Set((logRows || []).map((l: any) => p10(l.telefono)));
    // + roster fijo (socios/admin/etc): siempre en contacto
    try {
      const cfg = await sel(tUrl, tKey, "configuracion?clave=eq.whatsapp&select=valor");
      const arr = JSON.parse(cfg[0]?.valor || "[]");
      (Array.isArray(arr) ? arr : []).forEach((w: any) => { if (w.num) calientes.add(p10(w.num)); });
    } catch { /* sin roster */ }

    const texto = `${saludo()}. ${mensaje}`;
    const vistos = new Set<string>();
    const enviar: any[] = [], omitidos: any[] = [];
    for (const e of (emps || [])) {
      if (e.activo === false) continue;
      const raw = String(e.whatsapp || e.tel || "");
      const n10 = p10(raw);
      if (n10.length < 10) { omitidos.push({ nombre: e.nombre, motivo: "sin numero" }); continue; }
      if (roles && !roles.includes(String(e.cargo || "").toLowerCase())) continue;
      if (vistos.has(n10)) continue;   // dedupe: un numero compartido recibe UNA vez
      vistos.add(n10);
      if (!forzar && !calientes.has(n10)) { omitidos.push({ nombre: e.nombre, motivo: "no ha escrito (frio)" }); continue; }
      enviar.push({ telefono: norm(raw), mensaje: texto, tipo: "comunicado", nombre: e.nombre });
    }

    if (dry) return json({ ok: true, dry: true, empresa, saludo: saludo(), enviaria: enviar.length, calientes: calientes.size, omitidos });
    if (enviar.length) {
      const filas = enviar.map((x) => ({ telefono: x.telefono, mensaje: x.mensaje, tipo: "comunicado" }));
      const ins = await fetch(`${tUrl}/rest/v1/cola_mensajes`, { method: "POST", headers: { ...H(tKey), Prefer: "return=minimal" }, body: JSON.stringify(filas) });
      if (!ins.ok) return json({ ok: false, error: "no se pudo encolar: " + (await ins.text()) }, 500);
    }
    return json({ ok: true, empresa, enviados: enviar.length, omitidos_frios: omitidos.filter((o) => o.motivo.includes("frio")).map((o) => o.nombre), sin_numero: omitidos.filter((o) => o.motivo === "sin numero").length });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
});
// Saca el `sub` (id de usuario) del JWT de Supabase, SIN validar firma: no da acceso a datos por si
// mismo (todo lo sensible pasa por RLS/rol); solo identifica al usuario para mirar su rol en la tabla.
function subDeJWT(token: string): string {
  try {
    const parte = token.split(".")[1]; if (!parte) return "";
    const b64 = parte.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parte.length + 3) % 4);
    const payload = JSON.parse(atob(b64));
    return String(payload.sub || "");
  } catch { return ""; }
}
function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }
