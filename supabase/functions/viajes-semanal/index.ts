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
  // ⛔ LA SEMANA ES LUNES A DOMINGO. Máximo, 04/11/2026: «la incoherencia de lunes a sábado y
  //    lunes a domingo debes arreglarlo, todo debe ser de lunes a domingo».
  //
  // 🔴 NO ERA UNA INCOHERENCIA DE FORMATO: esto cerraba en SÁBADO y **los viajes del domingo no
  //    entraban en ninguna semana**. Medido en la semana del 26/10: la relación que ve el IMAU
  //    (lunes a domingo) trae 193 viajes y este cierre traía 174. La diferencia, 19, son
  //    exactamente los del domingo 01/11. Se le estuvo informando de menos a la Alcaldía.
  //
  // ⚠️ POR ESO ESTO AHORA CORRE EL LUNES, no el domingo: una semana que termina el domingo no se
  //    puede cerrar el domingo por la mañana. El cron pasó de `0 13 * * 0` a `0 13 * * 1`.
  const hoyStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
  const base = new Date(hoyStr + "T12:00:00Z");
  const lunes = new Date(base.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const sabado = new Date(base.getTime() - 1 * 86400000).toISOString().slice(0, 10);  // DOMINGO

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

  // ⛔ 04/11/2026. Esto decía «Facturado: **Bs** {totMonto}» y `planillas.m` está en
  //    DÓLARES. O sea que el cierre de semana que se manda afuera afirmaba bolívares
  //    sobre una cifra en dólares: un número 889 veces más chico, con la moneda
  //    equivocada. No es un detalle de formato — es el monto que se factura.
  //
  // ⛔ Y se dice CON QUÉ TARIFA se valoró, porque desde el lunes 05/10/2026 el viaje
  //    pasó de $316,88 a $261,20 y un total sin su tarifa no se puede verificar.
  //    Cada planilla ya trae su monto a la tarifa de SU fecha; acá solo se informa
  //    cuál o cuáles rigieron en la semana. [[norma-numero-que-el-dueno-no-puede-explicar]]
  const tarifas = [...new Set(plan.map((p: any) =>
    Number(p.t || 0) > 0 ? (Number(p.m || 0) / Number(p.t)).toFixed(2) : null).filter(Boolean))];
  let msg = `🗓️ Cierre de semana (${ddmm(lunes)} al ${ddmm(sabado)})\n\n`;
  msg += `🚛 Viajes totales: ${totViajes.toLocaleString("es-VE")}\n`;
  msg += `💵 Facturado: US$ ${totMonto.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
  if (tarifas.length === 1) msg += `📐 Tarifa: US$ ${tarifas[0]} por viaje (8 t)\n`;
  else if (tarifas.length > 1) msg += `📐 Tarifas en la semana: US$ ${tarifas.join(" y US$ ")} por viaje (8 t)\n`;
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
