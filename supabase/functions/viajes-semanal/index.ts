import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — Cierre de semana: reporte de VIAJES de la semana, los DOMINGOS.
// Suma las planillas de lunes a sábado (la semana que cerró) y manda por WhatsApp (Wassenger) el total
// de viajes + facturado + desglose por unidad. Destinatario: configuracion.viajes_semanal_tel (socio Jonaz).
// Solo ENCOLA en cola_mensajes (el worker antepone "♻️ Betangar:" y envía). Idempotente por semana.
// Cron: domingos. ?dry=1 = arma y devuelve sin encolar ni marcar.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel err", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function one(clave: string): Promise<string> {
  const r = await sel(`configuracion?clave=eq.${clave}&select=valor`);
  return String(r[0]?.valor ?? "").replace(/"/g, "");
}
async function enqueue(rows: any[]) {
  if (!rows.length) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("cola insert err", r.status, await r.text());
}
async function yaEnviado(key: string, dry: boolean): Promise<boolean> {
  const rows = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  if (rows.length) return true;
  if (dry) return false;
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
  return false;
}
const ddmm = (s: string) => { const p = s.split("-"); return `${p[2]}/${p[1]}`; };
const norm = (n: string) => String(n || "").replace(/[\s\-\+]/g, "");

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  // HOY en Venezuela (domingo). Semana que cerró = lunes..sábado anteriores.
  const hoyStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
  const base = new Date(hoyStr + "T12:00:00Z");
  const lunes = new Date(base.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const sabado = new Date(base.getTime() - 1 * 86400000).toISOString().slice(0, 10);

  // Mapa unidad → placa (norma: al nombrar una unidad, mostrar también la placa)
  const ucfg = await sel(`unidad_config?select=cam,placa`);
  const PLACA: Record<string, string> = {};
  for (const u of ucfg) { if (u.cam && u.placa) PLACA[String(u.cam)] = String(u.placa); }
  const Us = (cam: string) => { const s = String(cam).replace("JAC-", ""); return PLACA[cam] ? `${s} (${PLACA[cam]})` : s; };

  const plan = await sel(`planillas?f=gte.${lunes}&f=lte.${sabado}&select=cam,t,m`);
  let totViajes = 0, totMonto = 0;
  const porCam: Record<string, number> = {};
  for (const p of plan) {
    const cam = String(p.cam || ""); if (!cam) continue;
    const t = Number(p.t || 0), m = Number(p.m || 0);
    totViajes += t; totMonto += m;
    porCam[cam] = (porCam[cam] || 0) + t;
  }
  const lineas = Object.keys(porCam).sort().map((c) => `• ${Us(c)}: ${porCam[c]} viaje${porCam[c] === 1 ? "" : "s"}`);

  let msg = `🗓️ Cierre de semana (${ddmm(lunes)} al ${ddmm(sabado)})\n\n`;
  msg += `🚛 Viajes totales: ${totViajes.toLocaleString("es-VE")}\n`;
  msg += `💵 Facturado: Bs ${totMonto.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
  if (lineas.length) msg += `\nPor unidad:\n${lineas.join("\n")}`;

  const tel = norm(await one("viajes_semanal_tel"));
  const key = `viajes_sem_${sabado}`;

  if (dry) return json({ ok: true, dry: true, semana: `${lunes}..${sabado}`, totViajes, totMonto, tel, msg });
  if (!tel) return json({ ok: true, skip: "sin destinatario (configuracion.viajes_semanal_tel)" });
  if (await yaEnviado(key, dry)) return json({ ok: true, ya_enviado: true, key });

  await enqueue([{ telefono: tel, mensaje: msg, tipo: "viajes_semanal", estado: "pendiente" }]);
  return json({ ok: true, semana: `${lunes}..${sabado}`, totViajes, totMonto, encolado: 1 });
});

function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }); }
