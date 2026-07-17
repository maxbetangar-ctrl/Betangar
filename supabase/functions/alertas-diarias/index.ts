import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — alertas/resúmenes diarios por WhatsApp.
// MIGRADO a WASSENGER (2026-07-17): ya NO usa CallMeBot. Solo ENCOLA en cola_mensajes; el worker
// procesar_cola_wassenger antepone la etiqueta de la empresa ("♻️ Betangar:") y envía por Wassenger.
// Ventaja: un solo número, sin apikey por destinatario, con cola/reintentos.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel err", path, r.status, await r.text()); return []; }
  return await r.json();
}

// Encola mensajes en cola_mensajes (el worker Wassenger los envía con la etiqueta de empresa).
async function enqueue(rows: any[]) {
  if (!rows.length) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("cola insert err", r.status, await r.text());
}

function veNow(): Date { return new Date(Date.now() - 4 * 3600 * 1000); }
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function diasHasta(fechaStr: string): number {
  if (!fechaStr) return NaN;
  const f = new Date(String(fechaStr).slice(0, 10) + "T12:00:00Z");
  if (isNaN(f.getTime())) return NaN;
  const h = new Date(ymd(veNow()) + "T12:00:00Z");
  return Math.round((f.getTime() - h.getTime()) / 86400000);
}

const preview: any[] = [];
// Encola el texto a los destinos (por rol). El worker antepone "♻️ Betangar:" → aquí va SIN prefijo.
// Ya NO exige apikey por número (eso era de CallMeBot): basta num + activo.
async function waSend(text: string, roles: string[], wa: any[], dry: boolean) {
  const dest = wa.filter((w: any) => w.num && w.activo && (w.rol === "socios" || roles.includes(w.rol)));
  if (dry) { preview.push({ to: dest.map((d: any) => d.desc || d.rol), text }); return; }
  const rows = dest.map((w: any) => ({ telefono: String(w.num).replace(/[\s\-\+]/g, ""), mensaje: text, tipo: "alerta", estado: "pendiente" }));
  await enqueue(rows);
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

Deno.serve(async (_req: Request) => {
  try {
    const dry = new URL(_req.url).searchParams.get("dry") === "1";
    preview.length = 0;
    const cfg = await sel(`configuracion?clave=eq.whatsapp&select=valor`);
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = []; }
    if (!Array.isArray(wa) || !wa.length) return new Response(JSON.stringify({ ok: false, msg: "sin config whatsapp" }), { headers: { "Content-Type": "application/json" } });

    const hoy = veNow();
    const hoyD = ymd(hoy);
    const veHour = hoy.getUTCHours();
    const fechaStr = hoy.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const sent: any = { cumple: 0, ops: 0, checklist: 0, resumen: 0 };

    // 1) CUMPLEAÑOS
    const emps = await sel(`empleados?activo=eq.true&select=id,nombre,cargo,fnac`);
    const cumpleHoy = emps.filter((e: any) => { if (!e.fnac) return false; const d = new Date(String(e.fnac).slice(0, 10) + "T12:00:00Z"); return d.getUTCDate() === hoy.getUTCDate() && d.getUTCMonth() === hoy.getUTCMonth(); });
    for (const e of cumpleHoy) {
      const key = `cumple_${e.id}_${hoyD}`;
      if (await yaEnviado(key, dry)) continue;
      const d = new Date(String(e.fnac).slice(0, 10) + "T12:00:00Z");
      await waSend(`\u{1F382} HOY cumple años ${e.nombre} (${hoy.getUTCFullYear() - d.getUTCFullYear()} años) — ${e.cargo || ""}`, ["rrhh", "admin"], wa, dry);
      sent.cumple++;
    }

    // 2) SERVICE + LAVADOS (km_data)
    const km = await sel(`km_data?select=cam,km,lavado,estado`);
    const srv: string[] = [], lav: string[] = [];
    for (const k of km) {
      const cam = String(k.cam || ""); if (!cam.startsWith("JAC-")) continue;
      const kmv = Number(k.km || 0);
      if (kmv) { let prox = Math.ceil(kmv / 5000) * 5000; if (prox === kmv) prox += 5000; const faltan = prox - kmv; if (faltan <= 700) srv.push(`• ${cam}: faltan ${faltan.toLocaleString("es-VE")} km`); }
      if (k.lavado) { const dias = -diasHasta(k.lavado); if (!isNaN(dias) && dias > 45) lav.push(`• ${cam}: lavado vencido (${dias} días)`); }
    }

    // 3) CXP vencidas (+ pendientes para el resumen)
    const cxp = await sel(`cxp?estado=eq.pendiente&select=prov_nombre,neto_pagar,total_usd,fecha_venc`);
    const fact: string[] = [];
    for (const c of cxp) { const dr = diasHasta(c.fecha_venc); if (!isNaN(dr) && dr <= 0) fact.push(`• ${c.prov_nombre || "Proveedor"}: $${Number(c.neto_pagar || c.total_usd || 0).toFixed(0)} (venció ${String(c.fecha_venc).slice(0, 10)})`); }

    // 4) CONTRATOS por vencer
    const cons = await sel(`contratos?select=nombre,vencimiento,estado`);
    const contr: string[] = [];
    for (const c of cons) { if (c.estado === "finalizado" || c.estado === "cancelado") continue; const dr = diasHasta(c.vencimiento); if (!isNaN(dr) && dr > 0 && dr <= 60) contr.push(`• ${c.nombre || "Contrato"}: vence en ${dr} días`); }

    // 5) DOCUMENTOS por vencer
    const cfgDC = await sel(`configuracion?clave=eq.docs_cam&select=valor`);
    const cfgDE = await sel(`configuracion?clave=eq.docs_emp&select=valor`);
    let docsCam: any = {}, docsEmp: any = {};
    try { docsCam = JSON.parse(cfgDC[0]?.valor || "{}"); } catch { docsCam = {}; }
    try { docsEmp = JSON.parse(cfgDE[0]?.valor || "{}"); } catch { docsEmp = {}; }
    const empName = (id: string) => { const e = emps.find((x: any) => String(x.id) === String(id)); return e ? e.nombre : id; };
    const docs: string[] = [];
    for (const cam of Object.keys(docsCam)) for (const t of ["seguro", "circulacion", "revision"]) { const d = docsCam[cam] && docsCam[cam][t]; if (!d || !d.venc) continue; const dr = diasHasta(d.venc); if (isNaN(dr) || dr > 30) continue; docs.push(`• ${cam} ${t}: ${dr < 0 ? `VENCIDO hace ${Math.abs(dr)}d` : `vence en ${dr}d`}`); }
    for (const eid of Object.keys(docsEmp)) for (const t of ["cedula", "licencia", "medico"]) { const d = docsEmp[eid] && docsEmp[eid][t]; if (!d || !d.venc) continue; const dr = diasHasta(d.venc); if (isNaN(dr) || dr > 30) continue; docs.push(`• ${empName(eid)} ${t}: ${dr < 0 ? `VENCIDO hace ${Math.abs(dr)}d` : `vence en ${dr}d`}`); }

    // 6) SIN PLANILLA (>=3 dias)
    const plan = await sel(`planillas?select=cam,f`);
    const ultPlan: Record<string, string> = {};
    for (const p of plan) { const c = String(p.cam || ""); if (!c) continue; const f = String(p.f || ""); if (!ultPlan[c] || f > ultPlan[c]) ultPlan[c] = f; }
    const fleet = Array.from(new Set(km.map((k: any) => String(k.cam || "")).filter((c: string) => c.startsWith("JAC-B")))).sort();
    const sinPlan: string[] = [];
    for (const k of km) { const cam = String(k.cam || ""); if (!cam.startsWith("JAC-")) continue; const est = String(k.estado || "").toLowerCase(); if (est && est !== "operativo") continue; const last = ultPlan[cam]; const d = last ? -diasHasta(last) : 999; if (!isNaN(d) && d >= 3) sinPlan.push(`• ${cam}: ${last ? `${d} días` : "sin registro"} sin planilla`); }

    // 7) STOCK critico
    const inv = await sel(`inventario?select=nombre,stock,stock_min`);
    const stock: string[] = [];
    for (const it of inv) { const s = Number(it.stock || 0), mn = Number(it.stock_min || 0); if (s <= mn) stock.push(`• ${it.nombre}: ${s} (mín ${mn})`); }

    // ── DIGEST OPERATIVO (admin+socios, cada corrida) ──
    let ops = "";
    if (srv.length) ops += `\n\u{1F527} SERVICE PRÓXIMO:\n${srv.join("\n")}\n`;
    if (lav.length) ops += `\n\u{1F9FC} LAVADOS VENCIDOS:\n${lav.join("\n")}\n`;
    if (sinPlan.length) ops += `\n\u{1F69B} SIN PLANILLA (3+ días):\n${sinPlan.join("\n")}\n`;
    if (fact.length) ops += `\n\u{1F91D} FACTURAS VENCIDAS:\n${fact.join("\n")}\n`;
    if (contr.length) ops += `\n\u{1F4CB} CONTRATOS POR VENCER:\n${contr.join("\n")}\n`;
    if (docs.length) ops += `\n\u{1F4C4} DOCUMENTOS POR VENCER:\n${docs.join("\n")}\n`;
    if (stock.length) ops += `\n\u{1F4E6} STOCK CRÍTICO:\n${stock.join("\n")}\n`;
    if (ops) { await waSend(`\u{1F514} Resumen ${fechaStr}\n${ops}`, ["admin"], wa, dry); sent.ops = 1; }

    // Checklist de hoy (para resumen matutino y conteo nocturno)
    const ckRows = await sel(`checklist?fecha=eq.${hoyD}&select=cam,conductor,hora_salida,estado_vehiculo`);
    const ckByCam: Record<string, any> = {};
    for (const r of ckRows) { const c = String(r.cam || ""); if (c && !ckByCam[c]) ckByCam[c] = r; }

    // ── RESUMEN CHECKLIST (corrida de la mañana, ~8am) — quién llenó y quién NO ──
    if (veHour < 12) {
      const key = `checklist_resumen_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const llenos: string[] = [], faltan: string[] = [];
        for (const cam of fleet) {
          const b = cam.replace("JAC-", "");
          const r = ckByCam[cam];
          if (r) { const est = String(r.estado_vehiculo || "operativo"); llenos.push(`✅ ${b} - ${r.conductor || "--"}${est.toLowerCase() !== "operativo" ? ` (${est})` : ""}`); }
          else { faltan.push(`❌ ${b} - NO llenó checklist`); }
        }
        let msg = `\u{1F4CB} Checklist ${hoyD}\nLlenaron ${llenos.length} de ${fleet.length} unidades\n`;
        if (llenos.length) msg += `\nLLENARON:\n${llenos.join("\n")}\n`;
        if (faltan.length) msg += `\nFALTAN POR LLENAR:\n${faltan.join("\n")}`;
        await waSend(msg, ["socios", "mecanica", "operativo"], wa, dry);
        sent.checklist = 1;
      }
    }

    // ── RESUMEN DEL DÍA (corrida de la tarde, ~6pm) → socios ──
    if (veHour >= 12) {
      const key = `resumen_dia_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const vj = await sel(`viajes_chofer?fecha=eq.${hoyD}&select=id`);
        const gas = await sel(`gasoil?f=eq.${hoyD}&select=lit`);
        const litros = gas.reduce((a: number, r: any) => a + (parseFloat(r.lit) || 0), 0);
        const bncR = await sel(`bnc_notificaciones?fecha_recibido=gte.${hoyD}&select=monto`);
        const totalBnc = bncR.reduce((a: number, r: any) => a + (parseFloat(r.monto) || 0), 0);
        const camsCk = new Set(ckRows.map((r: any) => r.cam)).size;
        const cxpPend = cxp.reduce((a: number, c: any) => a + (parseFloat(c.neto_pagar || c.total_usd || 0) || 0), 0);
        const nov = ckRows.filter((r: any) => r.estado_vehiculo && String(r.estado_vehiculo).toLowerCase() !== "operativo").map((r: any) => `${String(r.cam).replace("JAC-", "")} (${r.estado_vehiculo})`);
        let msg = `\u{1F514} Resumen del día ${hoyD}\n\u{1F69B} Viajes: ${vj.length}\n⛽ Combustible: ${litros.toLocaleString("es-VE")} L\n\u{1F4B0} Pagos BNC: $${totalBnc.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\u{1F4CB} Checklists: ${camsCk}/${fleet.length}\n\u{1F4CC} CxP pendientes: $${cxpPend.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (nov.length) msg += `\n⚠️ Novedades: ${nov.join(", ")}`;
        await waSend(msg, ["socios"], wa, dry);
        sent.resumen = 1;
      }
    }

    return new Response(JSON.stringify({ ok: true, dry, veHour, sent, srv: srv.length, lav: lav.length, sinPlan: sinPlan.length, fact: fact.length, contr: contr.length, docs: docs.length, stock: stock.length, cumpleHoy: cumpleHoy.length, checklist_llenos: Object.keys(ckByCam).length, fleet: fleet.length, preview: dry ? preview : undefined }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("alertas-diarias error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
