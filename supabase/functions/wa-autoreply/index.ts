// AUTO-BIENVENIDA Wassenger (número compartido Betangar + Flotilla).
// Al PRIMER mensaje entrante de una persona, le responde UNA sola vez una bienvenida PERSONALIZADA
// con su nombre de la base, para confirmarle que a partir de ahora le llegan los avisos. Nunca repite
// (tabla wa_autoreply_log). Solo responde a empleados conocidos (si no está en ninguna base, no responde).
// Encola en la cola de la app que corresponde (el worker antepone la etiqueta de empresa y envía).
// Se llama por webhook de Wassenger (evento message:in). Auth por ?key=AUTOREPLY_SECRET.

const BET_URL = Deno.env.get("SUPABASE_URL")!;
const BET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLOT_URL = Deno.env.get("FLOT_URL")!;
const FLOT_KEY = Deno.env.get("FLOT_SERVICE_KEY")!;
const SECRET = Deno.env.get("AUTOREPLY_SECRET") || "";

const H = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });
const p10 = (s: string) => String(s || "").replace(/\D/g, "").slice(-10);
const primer = (n: string) => String(n || "").trim().split(/\s+/)[0] || "";
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

async function getEmpleados(url: string, key: string): Promise<any[]> {
  const r = await fetch(`${url}/rest/v1/empleados?select=nombre,whatsapp,tel,activo`, { headers: H(key) });
  if (!r.ok) { console.error("emp err", url, r.status); return []; }
  return await r.json();
}
function matchEmp(emps: any[], tgt: string): string | null {
  for (const e of emps) {
    const n = p10(e.whatsapp || "") || p10(e.tel || "");
    if (n && n === tgt && e.activo !== false) return e.nombre || "";
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (SECRET && url.searchParams.get("key") !== SECRET) return json({ ok: false, error: "no auth" }, 401);
    if (req.method !== "POST") return json({ ok: true, ping: true });

    const body = await req.json().catch(() => ({}));
    const data = body?.data || body || {};
    // Extraer número del remitente (varias formas segun Wassenger)
    let raw = data.fromNumber || data.phone || (data.chat && (data.chat.id || data.chat)) || data.from || data.wid || "";
    raw = String(raw);
    if (data.fromMe === true || raw.includes("@g.us")) return json({ ok: true, skip: "propio/grupo" }); // no responder a uno mismo ni a grupos
    const tel = p10(raw);
    if (tel.length < 7) return json({ ok: true, skip: "sin telefono", raw });

    // Buscar nombre + empresa (Betangar primero, luego Flotilla)
    let nombre: string | null = null, proj: "bet" | "flot" | null = null;
    const betEmps = await getEmpleados(BET_URL, BET_KEY);
    nombre = matchEmp(betEmps, tel);
    if (nombre !== null) proj = "bet";
    else {
      const flotEmps = await getEmpleados(FLOT_URL, FLOT_KEY);
      nombre = matchEmp(flotEmps, tel);
      if (nombre !== null) proj = "flot";
    }
    if (proj === null) return json({ ok: true, skip: "no es empleado conocido", tel });

    const empresa = proj === "bet" ? "Inversiones Betangar C.A." : "FLOTILLA S.A.";

    // CLAIM: insertar en el log; si ya existía (ya se le dio bienvenida) → no repetir.
    const claim = await fetch(`${BET_URL}/rest/v1/wa_autoreply_log`, {
      method: "POST", headers: { ...H(BET_KEY), Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify({ telefono: tel, nombre, empresa }),
    });
    const claimRows = claim.ok ? await claim.json().catch(() => []) : [];
    if (!Array.isArray(claimRows) || !claimRows.length) return json({ ok: true, ya_bienvenido: true, tel });

    // Encolar la bienvenida en la app correspondiente (el worker antepone "♻️ Betangar:" / "🚚 FLOTILLA:")
    const nom = cap(primer(nombre));
    const msg = `¡Hola ${nom}! 👋\n\n✅ Confirmado: a partir de ahora vas a recibir por este número tus avisos y recordatorios de ${empresa}. Ya quedaste registrado. 🙌\n\nGuarda este número en tus contactos para no perderte ningún mensaje.`;
    const targetUrl = proj === "bet" ? BET_URL : FLOT_URL;
    const targetKey = proj === "bet" ? BET_KEY : FLOT_KEY;
    const enq = await fetch(`${targetUrl}/rest/v1/cola_mensajes`, {
      method: "POST", headers: { ...H(targetKey), Prefer: "return=minimal" },
      body: JSON.stringify({ telefono: tel, mensaje: msg, tipo: "bienvenida", estado: "pendiente" }),
    });
    if (!enq.ok) console.error("enqueue err", enq.status, await enq.text());

    return json({ ok: true, bienvenida: true, nombre: nom, empresa, tel });
  } catch (e) {
    console.error("wa-autoreply error", String(e));
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
