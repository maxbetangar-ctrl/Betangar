import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — alertas/resúmenes diarios por WhatsApp (Wassenger; encola en cola_mensajes, worker antepone "♻️ Betangar:").
// Roles (configuracion.whatsapp): socios reciben TODO; admin, rrhh, mecanica, operativo reciben lo suyo.
// Jefe de Operaciones (operativo) recibe TODO lo operativo + resúmenes SIN NINGÚN DATO DE DINERO.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel err", path, r.status, await r.text()); return []; }
  return await r.json();
}
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

// Etiquetas del checklist (mismo mapa que CL_SECCIONES del dashboard).
const LBL_CL: Record<string, string> = {
  luz_delantera_alta: "Luz Delantera Alta", luz_delantera_baja: "Luz Delantera Baja",
  luces_emergencia: "Luces de Emergencia", luces_neblineros: "Luces Neblineros",
  luz_direccional: "Luz Direccional / Cruce", luz_freno_posterior: "Luz Freno Posterior",
  parabrisas_del: "Parabrisas Delantera", parabrisas_pos: "Parabrisas Posterior",
  limpia_parabrisas: "Limpia Parabrisas", vidrio_parabrisas: "Vidrio Parabrisas",
  espejos_laterales: "Espejos Laterales", tablero_indicadores: "Tablero / Indicadores",
  freno_mano: "Freno de Mano", freno_servicio: "Freno de Servicio",
  aceite_refrigerante: "Aceite y Refrigerante", espejo_retrovisor: "Espejo Retrovisor",
  tapa_combustible: "Tapa Tanque Combustible", gato_hidraulico: "Gato Hidráulico",
  herramientas: "Herramientas", conos_seguridad: "Conos de Seguridad", extintor: "Extintor",
  alarma_retroceso: "Alarma de Retroceso", cinturones: "Cinturones", cunas_seguridad: "Cuñas de Seguridad",
  lavado_tolva: "Lavado de Tolva", corte_corriente: "Corte de Corriente",
  aceite_motor: "Nivel Aceite de Motor", refrigerante: "Refrigerante",
  liquido_hidraulico: "Nivel Líquido Hidráulico", trampa_agua: "Trampa de Agua", fugas: "Fugas",
  presion_aire: "Presión de Aire", tuercas_esparragos: "Tuercas y Espárragos",
  drenaje_tanques: "Drenaje Tanques de Aire", llanta_repuesto: "Llanta de Repuesto",
  mangueras_hidraulicas: "Mangueras Hidráulicas", puntos_engrase: "Puntos de Engrase",
  botones_parada: "Botones Parada Emergencia", toma_fuerza: "Toma de Fuerza (PTO)",
};
const CRIT_CL: Record<string, number> = { freno_mano: 1, freno_servicio: 1, aceite_motor: 1, fugas: 1, presion_aire: 1, tuercas_esparragos: 1, mangueras_hidraulicas: 1, toma_fuerza: 1, llanta_repuesto: 1 };
const DANIOS_CL: Record<string, string> = { danio_frontal: "Daño frontal", danio_lateral_izq: "Daño lateral izq.", danio_lateral_der: "Daño lateral der.", danio_posterior: "Daño posterior", danio_techo: "Daño techo" };

const preview: any[] = [];
// Encola el texto a los destinos por rol. El worker antepone "♻️ Betangar:".
// soloRoles=true → NO incluir el comodín de socios (para mensajes que NO deben ver los socios de más).
async function waSend(text: string, roles: string[], wa: any[], dry: boolean, soloRoles = false) {
  const dest = wa.filter((w: any) => w.num && w.activo && ((!soloRoles && w.rol === "socios") || roles.includes(w.rol)));
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

    // Mapa unidad → placa (norma: al nombrar una unidad, mostrar también la placa)
    const ucfg = await sel(`unidad_config?select=cam,placa`);
    const PLACA: Record<string, string> = {};
    for (const u of ucfg) { if (u.cam && u.placa) PLACA[String(u.cam)] = String(u.placa); }
    const U = (cam: string) => PLACA[cam] ? `${cam} (${PLACA[cam]})` : cam;                       // "JAC-B008 (A04EO1P)"
    const Us = (cam: string) => { const s = String(cam).replace("JAC-", ""); return PLACA[cam] ? `${s} (${PLACA[cam]})` : s; }; // "B008 (A04EO1P)"

    const hoy = veNow();
    const hoyD = ymd(hoy);
    const veHour = hoy.getUTCHours();
    const fechaStr = hoy.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const sent: any = {};

    // 1) CUMPLEAÑOS (aviso a RRHH + Admin + Operativo + socios)
    const emps = await sel(`empleados?activo=eq.true&select=id,nombre,cargo,fnac`);
    const cumpleHoy = emps.filter((e: any) => { if (!e.fnac) return false; const d = new Date(String(e.fnac).slice(0, 10) + "T12:00:00Z"); return d.getUTCDate() === hoy.getUTCDate() && d.getUTCMonth() === hoy.getUTCMonth(); });
    for (const e of cumpleHoy) {
      const key = `cumple_${e.id}_${hoyD}`;
      if (await yaEnviado(key, dry)) continue;
      const d = new Date(String(e.fnac).slice(0, 10) + "T12:00:00Z");
      await waSend(`🎂 HOY cumple años ${e.nombre} (${hoy.getUTCFullYear() - d.getUTCFullYear()} años) — ${e.cargo || ""}`, ["rrhh", "admin", "operativo"], wa, dry);
    }

    // 2) SERVICE + LAVADOS (km_data)
    const km = await sel(`km_data?select=cam,km,lavado,estado`);
    const srv: string[] = [], lav: string[] = [];
    for (const k of km) {
      const cam = String(k.cam || ""); if (!cam.startsWith("JAC-")) continue;
      const kmv = Number(k.km || 0);
      if (kmv) { let prox = Math.ceil(kmv / 5000) * 5000; if (prox === kmv) prox += 5000; const faltan = prox - kmv; if (faltan <= 700) srv.push(`• ${U(cam)}: faltan ${faltan.toLocaleString("es-VE")} km`); }
      if (k.lavado) { const dias = -diasHasta(k.lavado); if (!isNaN(dias) && dias > 45) lav.push(`• ${U(cam)}: lavado vencido (${dias} días)`); }
    }

    // 3) CXP vencidas (DINERO — solo admin/socios)
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
    for (const cam of Object.keys(docsCam)) for (const t of ["seguro", "circulacion", "revision"]) { const d = docsCam[cam] && docsCam[cam][t]; if (!d || !d.venc) continue; const dr = diasHasta(d.venc); if (isNaN(dr) || dr > 30) continue; docs.push(`• ${U(cam)} ${t}: ${dr < 0 ? `VENCIDO hace ${Math.abs(dr)}d` : `vence en ${dr}d`}`); }
    for (const eid of Object.keys(docsEmp)) for (const t of ["cedula", "licencia", "medico"]) { const d = docsEmp[eid] && docsEmp[eid][t]; if (!d || !d.venc) continue; const dr = diasHasta(d.venc); if (isNaN(dr) || dr > 30) continue; docs.push(`• ${empName(eid)} ${t}: ${dr < 0 ? `VENCIDO hace ${Math.abs(dr)}d` : `vence en ${dr}d`}`); }

    // 6) SIN PLANILLA (>=3 dias)
    const plan = await sel(`planillas?select=cam,f`);
    const ultPlan: Record<string, string> = {};
    for (const p of plan) { const c = String(p.cam || ""); if (!c) continue; const f = String(p.f || ""); if (!ultPlan[c] || f > ultPlan[c]) ultPlan[c] = f; }
    const fleet = Array.from(new Set(km.map((k: any) => String(k.cam || "")).filter((c: string) => c.startsWith("JAC-B")))).sort();
    const sinPlan: string[] = [];
    for (const k of km) { const cam = String(k.cam || ""); if (!cam.startsWith("JAC-")) continue; const est = String(k.estado || "").toLowerCase(); if (est && est !== "operativo") continue; const last = ultPlan[cam]; const d = last ? -diasHasta(last) : 999; if (!isNaN(d) && d >= 3) sinPlan.push(`• ${U(cam)}: ${last ? `${d} días` : "sin registro"} sin planilla`); }

    // 7) STOCK critico
    const inv = await sel(`inventario?select=nombre,stock,stock_min`);
    const stock: string[] = [];
    for (const it of inv) { const s = Number(it.stock || 0), mn = Number(it.stock_min || 0); if (s <= mn) stock.push(`• ${it.nombre}: ${s} (mín ${mn})`); }

    // ── PRÓXIMO CAMBIO DE ACEITE → Mecánica + Operativo + Socios ──
    if (srv.length) { await waSend(`🔧 Próximo cambio de aceite\n${srv.join("\n")}`, ["mecanica", "operativo"], wa, dry); }

    // ── DIGEST OPERATIVO ──
    // Parte SIN dinero (lavados, sin planilla, contratos, documentos, stock).
    let opsBase = "";
    if (lav.length) opsBase += `\n🧼 LAVADOS VENCIDOS:\n${lav.join("\n")}\n`;
    if (sinPlan.length) opsBase += `\n🚛 SIN PLANILLA (3+ días):\n${sinPlan.join("\n")}\n`;
    if (contr.length) opsBase += `\n📋 CONTRATOS POR VENCER:\n${contr.join("\n")}\n`;
    if (docs.length) opsBase += `\n📄 DOCUMENTOS POR VENCER:\n${docs.join("\n")}\n`;
    if (stock.length) opsBase += `\n📦 STOCK CRÍTICO:\n${stock.join("\n")}\n`;
    // Parte de DINERO (facturas vencidas) — solo admin/socios.
    const opsDinero = fact.length ? `\n🤝 FACTURAS VENCIDAS:\n${fact.join("\n")}\n` : "";
    if (opsBase || opsDinero) { await waSend(`🔔 Resumen ${fechaStr}\n${opsBase}${opsDinero}`, ["admin"], wa, dry); }        // admin + socios (con dinero)
    if (opsBase) { await waSend(`🔔 Resumen operativo ${fechaStr}\n${opsBase}`, ["operativo"], wa, dry, true); }             // Samuel (sin dinero)

    // Checklist de hoy (para resumen matutino, conteo y ANOMALÍAS)
    const ckRows = await sel(`checklist?fecha=eq.${hoyD}&select=*`);
    const ckByCam: Record<string, any> = {};
    for (const r of ckRows) { const c = String(r.cam || ""); if (!c) continue; if (!ckByCam[c] || String(r.created_at) > String(ckByCam[c].created_at)) ckByCam[c] = r; }

    // ── ANOMALÍAS DEL CHECKLIST (solo lo MALO + observación) → Mecánica + Operativo + Socios ──
    if (veHour < 12) {
      const key = `checklist_fallas_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const filasAnom: string[] = []; let nCrit = 0;
        for (const cam of Object.keys(ckByCam).sort()) {
          const c = ckByCam[cam]; const mal: string[] = []; let crit = false;
          for (const k of Object.keys(LBL_CL)) { if (c[k] === "mal") { mal.push(LBL_CL[k]); if (CRIT_CL[k]) crit = true; } }
          for (const d of Object.keys(DANIOS_CL)) { const v = String(c[d] || "").trim(); if (v && v !== "0" && v !== "ok") { mal.push(DANIOS_CL[d]); crit = true; } }
          const obs = [String(c.observaciones || "").trim(), String(c.chofer_observaciones || "").trim()].filter(Boolean).join(" · ");
          if (!mal.length && !obs) continue;
          if (crit) nCrit++;
          const det: string[] = [];
          if (obs) det.push(obs);
          if (mal.length) det.push(`Fallas: ${mal.join(", ")}`);
          filasAnom.push(`${Us(cam)}${crit ? " ⚠️" : ""} — ${c.conductor || "--"}\n📝 ${det.join(" | ")}`);
        }
        if (filasAnom.length) {
          const cab = `🔧 Anomalías del checklist (hoy)\n${filasAnom.length} camión(es) con novedad${nCrit ? ` · ${nCrit} crítico(s)` : ""}\n\n`;
          await waSend(cab + filasAnom.join("\n\n"), ["mecanica", "operativo"], wa, dry);
          sent.anomalias = filasAnom.length;
        }
      }
    }

    // ── RESUMEN CHECKLIST (mañana, ~8am) — quién llenó y quién NO → socios/mecanica/operativo ──
    if (veHour < 12) {
      const key = `checklist_resumen_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const llenos: string[] = [], faltan: string[] = [];
        for (const cam of fleet) {
          const r = ckByCam[cam];
          if (r) { const est = String(r.estado_vehiculo || "operativo"); llenos.push(`✅ ${Us(cam)} - ${r.conductor || "--"}${est.toLowerCase() !== "operativo" ? ` (${est})` : ""}`); }
          else { faltan.push(`❌ ${Us(cam)} - NO llenó checklist`); }
        }
        let msg = `📋 Checklist ${hoyD}\nLlenaron ${llenos.length} de ${fleet.length} unidades\n`;
        if (llenos.length) msg += `\nLLENARON:\n${llenos.join("\n")}\n`;
        if (faltan.length) msg += `\nFALTAN POR LLENAR:\n${faltan.join("\n")}`;
        await waSend(msg, ["socios", "mecanica", "operativo"], wa, dry);
        sent.checklist = 1;
      }
    }

    // ── RESUMEN DEL DÍA (tarde, ~6pm) ──
    if (veHour >= 12) {
      const key = `resumen_dia_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const vj = await sel(`viajes_chofer?fecha=eq.${hoyD}&select=id`);
        const gas = await sel(`gasoil?f=eq.${hoyD}&select=lit`);
        const litros = gas.reduce((a: number, r: any) => a + (parseFloat(r.lit) || 0), 0);
        const bncR = await sel(`bnc_notificaciones?fecha_recibido=gte.${hoyD}&select=monto`);
        const totalBnc = bncR.reduce((a: number, r: any) => a + (parseFloat(r.monto) || 0), 0);
        const camsCk = Object.keys(ckByCam).length;
        const cxpPend = cxp.reduce((a: number, c: any) => a + (parseFloat(c.neto_pagar || c.total_usd || 0) || 0), 0);
        const nov = Object.values(ckByCam).filter((r: any) => r.estado_vehiculo && String(r.estado_vehiculo).toLowerCase() !== "operativo").map((r: any) => `${Us(r.cam)} (${r.estado_vehiculo})`);
        // Operativo (sin dinero): viajes, combustible, checklists, novedades.
        let base = `🚛 Viajes: ${vj.length}\n⛽ Combustible: ${litros.toLocaleString("es-VE")} L\n📋 Checklists: ${camsCk}/${fleet.length}`;
        if (nov.length) base += `\n⚠️ Novedades: ${nov.join(", ")}`;
        // Socios (con dinero): agrega pagos BNC + CxP.
        const conDinero = `🚛 Viajes: ${vj.length}\n⛽ Combustible: ${litros.toLocaleString("es-VE")} L\n💰 Pagos BNC: $${totalBnc.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n📋 Checklists: ${camsCk}/${fleet.length}\n📌 CxP pendientes: $${cxpPend.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` + (nov.length ? `\n⚠️ Novedades: ${nov.join(", ")}` : "");
        await waSend(`🔔 Resumen del día ${hoyD}\n${conDinero}`, ["socios"], wa, dry);                     // socios (con dinero)
        await waSend(`🔔 Resumen del día ${hoyD}\n${base}`, ["operativo"], wa, dry, true);                  // Samuel (sin dinero)
        sent.resumen = 1;
      }
    }

    return new Response(JSON.stringify({ ok: true, dry, veHour, sent, srv: srv.length, lav: lav.length, sinPlan: sinPlan.length, fact: fact.length, docs: docs.length, stock: stock.length, cumpleHoy: cumpleHoy.length, fleet: fleet.length, preview: dry ? preview : undefined }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("alertas-diarias error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
