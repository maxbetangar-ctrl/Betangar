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
// ⛔ POSTGREST DEVUELVE 1.000 FILAS COMO MÁXIMO Y NO AVISA.
// No hay error ni excepción: simplemente faltan filas, y una lista incompleta se ve
// idéntica a una completa. Para una tabla que crece (una fila por evento) hay que pedir
// por páginas con el header Range.
//
// PASÓ ACÁ, EN VIVO (medido el 2026-08-03): `planillas` tiene 1.297 filas y esta función
// las leía de un solo tiro. Se quedaba con 1.000 —las más viejas—, así que la "última
// planilla" de cada camión quedaba congelada en el 29/07 y el aviso decía que DIEZ de los
// doce camiones llevaban 5-7 días sin cargar planilla. Habían cargado el 1 y el 2 de agosto.
// Un aviso falso repetido es peor que no avisar: enseña a ignorar el mensaje.
//
// ⚠️ El orden tiene que ser ESTABLE (una columna única de desempate), si no una fila puede
// cambiar de página entre dos pedidos y aparecer dos veces o ninguna.
async function selPag(tabla: string, query: string): Promise<any[]> {
  const TAM = 1000; let desde = 0; const todo: any[] = [];
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${query}`, {
      headers: { ...HDR, Range: `${desde}-${desde + TAM - 1}` },
    });
    if (!r.ok) { console.error("selPag err", tabla, r.status, await r.text()); return todo; }
    const c = await r.json();
    if (!Array.isArray(c)) return todo;
    todo.push(...c);
    if (c.length < TAM) return todo;
    desde += TAM;
    if (desde > 500000) return todo;   // tope de seguridad
  }
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
// Fecha como la lee la gente acá: dd/mm/yyyy. [[norma-fecha-venezolana-dd-mm-yyyy]]
function fmt(iso: string): string {
  const s = String(iso || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function diasHasta(fechaStr: string): number {
  if (!fechaStr) return NaN;
  const f = new Date(String(fechaStr).slice(0, 10) + "T12:00:00Z");
  if (isNaN(f.getTime())) return NaN;
  const h = new Date(ymd(veNow()) + "T12:00:00Z");
  return Math.round((f.getTime() - h.getTime()) / 86400000);
}

// Etiquetas del checklist (mismo mapa que CL_SECCIONES del dashboard).
// NOTA (2026-07-20): ya no se usan para armar el aviso de fallas — eso ahora sale de la
// tabla `anomalias` (fuente única, con su propio label). Se conservan como catálogo de
// referencia de los ítems del checklist.
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
  drenaje_tanques: "Drenaje Tanques de Aire",
  mangueras_hidraulicas: "Mangueras Hidráulicas", puntos_engrase: "Puntos de Engrase",
  botones_parada: "Botones Parada Emergencia", toma_fuerza: "Toma de Fuerza (PTO)",
};
const CRIT_CL: Record<string, number> = { freno_mano: 1, freno_servicio: 1, aceite_motor: 1, fugas: 1, presion_aire: 1, tuercas_esparragos: 1, mangueras_hidraulicas: 1, toma_fuerza: 1 };
const DANIOS_CL: Record<string, string> = { danio_frontal: "Daño frontal", danio_lateral_izq: "Daño lateral izq.", danio_lateral_der: "Daño lateral der.", danio_posterior: "Daño posterior", danio_techo: "Daño techo" };

const preview: any[] = [];
// Encola el texto a los destinos por rol. El worker antepone "♻️ Betangar:".
// soloRoles=true → NO incluir el comodín de socios (para mensajes que NO deben ver los socios de más).
async function waSend(text: string, roles: string[], wa: any[], dry: boolean, soloRoles = false) {
  const dest = wa.filter((w: any) => w.num && w.activo && ((!soloRoles && w.rol === "socios") || roles.includes(w.rol)));
  // Dedupe por número: si un mismo teléfono está en el config bajo dos roles (o repetido),
  // NO debe recibir el MISMO mensaje dos veces en un mismo envío.
  const vistos = new Set<string>();
  const uniq = dest.filter((w: any) => { const n = String(w.num).replace(/[\s\-\+]/g, ""); if (!n || vistos.has(n)) return false; vistos.add(n); return true; });
  if (dry) { preview.push({ to: uniq.map((d: any) => d.desc || d.rol), text }); return; }
  const rows = uniq.map((w: any) => ({ telefono: String(w.num).replace(/[\s\-\+]/g, ""), mensaje: text, tipo: "alerta", estado: "pendiente" }));
  await enqueue(rows);
}
// ── DIGEST: UN SOLO MENSAJE POR PERSONA ──────────────────────────────────────
// Antes esta función mandaba hasta 5 mensajes sueltos con minutos de diferencia
// (cumpleaños, aceite, resumen, fallas, checklist). Cada uno gasta un mensaje de
// Wassenger y le llega a la misma gente casi al mismo tiempo.
// Ahora las secciones se ACUMULAN y al final sale UNO por destinatario, con una
// línea divisoria entre secciones para que se note que son reportes distintos.
// Se agrupa por NÚMERO, no por rol: así quien está bajo dos roles recibe uno solo,
// y se respeta que operativo NO ve dinero (esos son bloques distintos).
const DIV = "━━━━━━━━━━━━━━━";
type Bloque = { texto: string; roles: string[]; soloRoles: boolean };
const bloques: Bloque[] = [];
function addBloque(texto: string, roles: string[], soloRoles = false) {
  if (texto && texto.trim()) bloques.push({ texto: texto.trim(), roles, soloRoles });
}
async function enviarDigest(cabecera: string, wa: any[], dry: boolean): Promise<number> {
  if (!bloques.length) return 0;
  // número → secciones que le tocan, en el orden en que se fueron agregando
  const porNum = new Map<string, { desc: string; partes: string[] }>();
  for (const b of bloques) {
    const dest = wa.filter((w: any) => w.num && w.activo && ((!b.soloRoles && w.rol === "socios") || b.roles.includes(w.rol)));
    const vistos = new Set<string>();
    for (const w of dest) {
      const n = String(w.num).replace(/[\s\-\+]/g, "");
      if (!n || vistos.has(n)) continue;                 // el mismo número bajo dos roles no repite sección
      vistos.add(n);
      if (!porNum.has(n)) porNum.set(n, { desc: w.desc || w.rol, partes: [] });
      porNum.get(n)!.partes.push(b.texto);
    }
  }
  const armar = (partes: string[]) => `${cabecera}\n\n${partes.join(`\n\n${DIV}\n\n`)}`;
  if (dry) {
    for (const [, e] of porNum) preview.push({ to: e.desc, secciones: e.partes.length, text: armar(e.partes) });
    return porNum.size;
  }
  await enqueue([...porNum.entries()].map(([n, e]) => ({ telefono: n, mensaje: armar(e.partes), tipo: "alerta", estado: "pendiente" })));
  return porNum.size;
}
// ── LAVADO: no una lista, una RECOMENDACIÓN ──────────────────────────────────
// Pedido de Máximo (2026-08-03). Los camiones se lavan el DOMINGO, así que el aviso
// sale el VIERNES y no todos los días. Y una lista de doce placas no ayuda a decidir:
// lo que hace falta es "lavá estos tres". Van primero los MÁS vencidos — que es el
// orden en que la unidad lleva más tiempo sucia, no el orden en que están cargadas.
// Los demás siguen apareciendo abajo: recomendar no es esconder el resto.
const LAVADOS_POR_DOMINGO = 3;   // cuántos se alcanzan a lavar un domingo (subir a 4 si da el tiempo)
function textoLavado(lav: { u: string; dias: number }[]): string {
  const orden = [...lav].sort((a, b) => b.dias - a.dias);
  const top = orden.slice(0, LAVADOS_POR_DOMINGO);
  const resto = orden.slice(LAVADOS_POR_DOMINGO);
  let t = `🧼 LAVADO — para el domingo\n\n👉 Te recomiendo lavar ${top.length === 1 ? "este" : `estos ${top.length}`}:\n`;
  t += top.map((x, i) => `  ${i + 1}. ${x.u} — vencido hace ${x.dias} días`).join("\n");
  if (resto.length) t += `\n\nLos demás vencidos:\n` + resto.map((x) => `  • ${x.u} — ${x.dias} días`).join("\n");
  return t;
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
    bloques.length = 0;   // ⛔ es de módulo: sin esto, la corrida de las 6pm reenvía lo de las 8am
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
      addBloque(`🎂 HOY cumple años ${e.nombre} (${hoy.getUTCFullYear() - d.getUTCFullYear()} años) — ${e.cargo || ""}`, ["rrhh", "admin", "operativo"]);
    }

    // 2) SERVICE + LAVADOS — FUENTE DE VERDAD = mantenimientos (item_id); km_data solo respaldo.
    // Antes leía únicamente km_data.lavado (espejo frágil) → ignoraba lavados/servicios hechos por
    // hoja de vida u orden de servicio y avisaba en falso. Ahora cruza contra los eventos reales.
    // `estado_desde` y `nota_estado` los pide el detector de divergencias de más abajo.
    const km = await sel(`km_data?select=cam,km,lavado,estado,estado_desde,nota_estado`);
    // Último LAVADO real por cam (MAX fecha de mantenimientos item_id=lavado). item_id filtra pocas filas → sin tope.
    const mLav = await sel(`mantenimientos?item_id=eq.lavado&select=cam,f&limit=2000`);
    const ultLav: Record<string, string> = {};
    for (const m of mLav) { const c = String(m.cam || ""); const f = String(m.f || "").slice(0, 10); if (!c || !f) continue; if (!ultLav[c] || f > ultLav[c]) ultLav[c] = f; }
    // Último CAMBIO DE ACEITE real por cam (fecha + km) para avisar VENCIDO por km recorrido (no por redondeo).
    const mAce = await sel(`mantenimientos?item_id=eq.aceite_motor&select=cam,f,km&order=f.desc&limit=2000`);
    const ultAceKm: Record<string, number> = {};
    for (const m of mAce) { const c = String(m.cam || ""); if (!c || ultAceKm[c] !== undefined) continue; const kmm = Number(m.km || 0); if (kmm > 0) ultAceKm[c] = kmm; }
    const srv: string[] = [];
    // El lavado guarda el DATO (unidad + días vencidos), no el texto ya armado: el aviso
    // del viernes tiene que ORDENARLOS por vencimiento para recomendar cuáles se lavan
    // el domingo, y de una lista de strings ya no se puede ordenar por días.
    const lav: { u: string; dias: number }[] = [];
    for (const k of km) {
      const cam = String(k.cam || ""); if (!cam.startsWith("JAC-")) continue;
      const kmv = Number(k.km || 0);
      if (kmv) {
        const kmUlt = ultAceKm[cam];
        if (kmUlt !== undefined) {
          // Con dato real: avisar por km RECORRIDO desde el último cambio (incluye VENCIDO; antes desaparecía solo).
          const recorrido = kmv - kmUlt;
          if (recorrido >= 5000) srv.push(`• ${U(cam)}: aceite VENCIDO (${recorrido.toLocaleString("es-VE")} km desde el último)`);
          else if (5000 - recorrido <= 700 && 5000 - recorrido >= 0) srv.push(`• ${U(cam)}: faltan ${(5000 - recorrido).toLocaleString("es-VE")} km para el aceite`);
        } else {
          // Sin dato de mantenimiento: aviso proactivo por múltiplo de 5.000 (comportamiento previo).
          let prox = Math.ceil(kmv / 5000) * 5000; if (prox === kmv) prox += 5000; const faltan = prox - kmv; if (faltan <= 700) srv.push(`• ${U(cam)}: faltan ${faltan.toLocaleString("es-VE")} km`);
        }
      }
      // Lavado: MÁXIMO entre el espejo km_data.lavado y el mantenimiento real (sin doble conteo).
      let fLav = String(k.lavado || "").slice(0, 10);
      if (ultLav[cam] && (!fLav || ultLav[cam] > fLav)) fLav = ultLav[cam];
      if (fLav) { const dias = -diasHasta(fLav); if (!isNaN(dias) && dias > 45) lav.push({ u: U(cam), dias }); }
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
    // Paginada a propósito: son >1.000 filas y de acá sale la "última planilla" de cada
    // camión. Ver selPag() — leerla de un tiro daba diez avisos falsos de "sin planilla".
    const plan = await selPag("planillas", `select=cam,f&order=f.asc,cam.asc`);
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
    if (srv.length) { addBloque(`🔧 Próximo cambio de aceite\n${srv.join("\n")}`, ["mecanica", "operativo"]); }

    // ── DIGEST OPERATIVO ──
    // Parte SIN dinero (lavados, sin planilla, contratos, documentos, stock).
    //
    // ⚠️ FRECUENCIA (pedido de Máximo 2026-08-03): dos de estas secciones no cambian
    // de un día para otro y avisarlas a diario solo gasta mensajes y se vuelve ruido
    // que nadie lee. Se recortan a un día fijo de la semana:
    //   • SIN PLANILLA → MIÉRCOLES y SÁBADOS     • LAVADO → solo VIERNES
    // El resto (contratos, documentos, facturas) sigue diario: ahí un día importa.
    // `hoy` ya viene corrido a hora de Venezuela, así que getUTCDay() es el día real
    // del negocio, no el del servidor. 0=domingo … 3=miércoles, 5=viernes, 6=sábado.
    const diaSem = hoy.getUTCDay();
    // Dos veces por semana alcanza para que las planillas no se acumulen sin que el
    // aviso se vuelva ruido diario (Máximo, 2026-08-03).
    const esDiaPlanilla = diaSem === 3 || diaSem === 6;
    // El lavado se hace el DOMINGO: avisando el VIERNES quedan dos días para organizarlo.
    const esDiaLavado = diaSem === 5;
    let opsBase = "";
    if (lav.length && esDiaLavado) opsBase += `\n${textoLavado(lav)}\n`;
    if (sinPlan.length && esDiaPlanilla) opsBase += `\n🚛 SIN PLANILLA (3+ días):\n${sinPlan.join("\n")}\n`;
    if (contr.length) opsBase += `\n📋 CONTRATOS POR VENCER:\n${contr.join("\n")}\n`;
    if (docs.length) opsBase += `\n📄 DOCUMENTOS POR VENCER:\n${docs.join("\n")}\n`;
    // Stock crítico: quitado del aviso por pedido de Máximo (no se envía a nadie).
    // Parte de DINERO (facturas vencidas) — solo admin/socios.
    const opsDinero = fact.length ? `\n🤝 FACTURAS VENCIDAS:\n${fact.join("\n")}\n` : "";
    // Este resumen salía en las DOS corridas del día (8am y 6pm) — el mismo texto dos
    // veces. Ahora se marca por día: sale en la primera corrida que tenga algo que decir.
    if (opsBase || opsDinero) {
      if (!(await yaEnviado(`resumen_ops_${hoyD}`, dry))) {
        addBloque(`🔔 Resumen ${fechaStr}\n${opsBase}${opsDinero}`, ["admin"]);            // admin + socios (con dinero)
        if (opsBase) addBloque(`🔔 Resumen operativo ${fechaStr}\n${opsBase}`, ["operativo"], true); // Samuel (sin dinero)
      }
    }

    // Checklist de hoy (para resumen matutino, conteo y ANOMALÍAS)
    const ckRows = await sel(`checklist?fecha=eq.${hoyD}&select=*`);
    const ckByCam: Record<string, any> = {};
    for (const r of ckRows) { const c = String(r.cam || ""); if (!c) continue; if (!ckByCam[c] || String(r.created_at) > String(ckByCam[c].created_at)) ckByCam[c] = r; }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // DIVERGENCIAS DE FLOTA — el dato que se contradice con otro dato
    //
    // POR QUÉ EXISTE (2026-08-10). El dashboard mostró «B004 — TALLER · 22d». En esos 22 días
    // la unidad hizo 21 planillas y 47 viajes. Nadie lo notó en tres semanas, y lo agarró el
    // dueño mirando la pantalla — no el sistema. Peor: la contradicción estaba en la MISMA
    // FILA del checklist («taller_betangar» al lado de «salió 05:42, volvió 13:17, 128 km»).
    //
    // Ninguna de las tres cosas de abajo puede ser cierta a la vez. Cuando pasa, el sistema
    // no sabe cuál de los dos datos vale, y lo único honesto es PREGUNTAR, no elegir solo.
    // Es el mismo patrón que `edu_divergencias_fuente_unica` en EduControl.
    // [[norma-fuente-unica-datos]] [[norma-numero-que-el-dueno-no-puede-explicar]]
    //
    // Sale UNA VEZ AL DÍA (`yaEnviado`), no en las dos corridas: un aviso que salta siempre
    // no avisa de nada. Y no lleva plata, así que puede ir completo al jefe de operaciones.
    // ══════════════════════════════════════════════════════════════════════════════════════
    {
      const key = `flota_divergencias_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const div: string[] = [];
        for (const k of km) {
          const cam = String(k.cam || "");
          if (!cam.startsWith("JAC-")) continue;
          const est = String(k.estado || "").toLowerCase();
          if (!est || est === "operativo") continue;      // solo las que figuran FUERA de circulación

          // 1) Figura fuera de circulación y HOY rodó (el checklist de hoy lo prueba).
          const c = ckByCam[cam];
          const kS = Number(c?.km_salida || c?.chofer_km_salida || 0) || 0;
          const kE = Number(c?.km_entrada || c?.chofer_km_entrada || 0) || 0;
          const volvio = String(c?.hora_entrada || "").trim();
          if (c && (kE > kS || volvio)) {
            const rec = kE > kS ? ` · ${kE - kS} km` : "";
            const obs = String(c.observaciones || "").trim();
            div.push(`🔴 ${Us(cam)} figura ${est.toUpperCase()} pero HOY TRABAJÓ\n` +
              `   salió ${c.hora_salida || "?"}, volvió ${volvio || "?"}${rec}` +
              (obs ? `\n   reportó: «${obs}»` : "") +
              `\n   👉 O está operativa, o alguien la marcó mal.`);
            continue;                                     // ya se avisó por lo más fuerte
          }

          // 2) Figura fuera desde una fecha, pero cargó planillas DESPUÉS. Es el caso exacto
          //    de la B004: 21 planillas posteriores a su `estado_desde`.
          const desde = String(k.estado_desde || "").slice(0, 10);
          const ult = ultPlan[cam] || "";
          if (desde && ult && ult > desde) {
            const nPost = plan.filter((p: any) => String(p.cam) === cam && String(p.f || "") > desde).length;
            div.push(`🔴 ${Us(cam)} figura ${est.toUpperCase()} desde el ${fmt(desde)} ` +
              `pero tiene ${nPost} planilla(s) después — la última el ${fmt(ult)}\n` +
              `   👉 La fecha de salida de circulación está mal, o esas planillas no son suyas.`);
            continue;
          }

          // 3) Figura fuera y NADIE escribió por qué. No es una contradicción, es un hueco:
          //    un camión parado sin motivo es plata que nadie está explicando.
          if (!String(k.nota_estado || "").trim()) {
            const d = desde ? -diasHasta(desde) : NaN;
            div.push(`🟡 ${Us(cam)} figura ${est.toUpperCase()}` +
              (isNaN(d) ? " (sin fecha de salida de circulación)" : ` hace ${d} día(s)`) +
              ` y nadie escribió por qué.`);
          }
        }
        if (div.length) {
          addBloque(`🚨 Datos de flota que se contradicen\n\n${div.join("\n\n")}`, ["admin", "mecanica", "operativo"]);
          sent.divergencias = div.length;
        }
      }
    }

    // ── FALLAS PENDIENTES (tabla `anomalias` = FUENTE ÚNICA) → Mecánica + Operativo + Socios ──
    // Antes esto leía la fila del checklist de HOY: una falla reportada ayer y NO arreglada
    // desaparecía del aviso (y de la pantalla). Ahora lista lo que sigue ABIERTO, con los días
    // que lleva sin resolver — es exactamente lo que el chofer ve en su celular.
    if (veHour < 12) {
      const key = `checklist_fallas_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const abiertas = await sel(`anomalias?estado=eq.abierta&select=cam,label,critico,detalle,fecha_reporte&order=critico.desc,fecha_reporte.asc`);
        const porCamA: Record<string, any[]> = {};
        for (const a of abiertas) { const c = String(a.cam || ""); if (!c) continue; (porCamA[c] = porCamA[c] || []).push(a); }
        const filasAnom: string[] = []; let nCrit = 0;
        for (const cam of Object.keys(porCamA).sort()) {
          const lista = porCamA[cam];
          const crit = lista.some((a: any) => !!a.critico);
          if (crit) nCrit++;
          const items = lista.map((a: any) => {
            const d = -diasHasta(String(a.fecha_reporte || ""));
            const ant = isNaN(d) ? "" : (d <= 0 ? " (hoy)" : ` (${d} día${d > 1 ? "s" : ""} sin resolver)`);
            return `${a.critico ? "🔴" : "🟡"} ${a.label}${ant}${a.detalle ? ` — ${a.detalle}` : ""}`;
          });
          filasAnom.push(`${Us(cam)}${crit ? " ⚠️" : ""}\n${items.join("\n")}`);
        }
        if (filasAnom.length) {
          const cab = `🔧 Fallas pendientes\n${abiertas.length} falla(s) en ${filasAnom.length} unidad(es)${nCrit ? ` · ${nCrit} unidad(es) con falla crítica` : ""}\n\n`;
          addBloque(cab + filasAnom.join("\n\n"), ["mecanica", "operativo"]);
          sent.anomalias = abiertas.length;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // EL CHOFER NO PUEDE REGISTRAR — el hueco que no se ve porque NO PASA NADA
    //
    // POR QUÉ EXISTE (2026-08-11). El 03/08 la foto del surtido pasó a la cámara dentro de la
    // página, que exige un permiso del navegador que antes no hacía falta. Melvin Barboza
    // (JAC-B004) registró su última surtida el 01/08 y no volvió a registrar ninguna. Nos
    // enteramos DIEZ DÍAS DESPUÉS por un WhatsApp suyo. Antes había pasado lo mismo con Omar
    // (08/08). Dos personas, la misma pared, y en las dos el sistema no dijo nada.
    //
    // ⛔ Un error se ve. Esto no: la pantalla no falla, simplemente NO ENTRA EL DATO. Y como
    // `gasoil` está muerto desde el 08/07 (proceso), la surtida del chofer es hoy la ÚNICA
    // fuente del costo de combustible: cada día sin registrar es plata que no entra a la
    // Utilidad Real y que después nadie puede explicar.
    // [[norma-numero-que-el-dueno-no-puede-explicar]] [[norma-mirar-la-ultima-corrida-no-la-existencia]]
    //
    // Son dos cosas distintas y se dicen distinto:
    //   • LA CAUSA — el teléfono avisa que tiene el permiso negado (lo reporta `permiso_reportar`).
    //   • EL HUECO — la unidad trabaja y nadie registra su combustible. Vale aunque la causa sea
    //     otra (el chofer no sabe, la app no abre, o efectivamente no cargó).
    //
    // ⚠️ LA PREMISA, MEDIDA Y NO SUPUESTA (11/08): en las 13 brechas que hay entre dos surtidas
    // de una misma unidad, la MAYOR fue de 8 días trabajados y la mediana de 4. Por eso el aviso
    // salta a partir de 9 días TRABAJADOS (planillas, no días de calendario: un camión parado no
    // gasta combustible). Si mañana la flota cambia de ritmo, este número hay que volver a medirlo.
    // [[norma-auditoria-precondicion-antes-de-acusar]]
    //
    // Sale UNA VEZ AL DÍA. No lleva plata → va completo al jefe de operaciones.
    // ══════════════════════════════════════════════════════════════════════════════════════
    {
      const key = `chofer_no_registra_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const trabas: string[] = [];

        // ── (a) LA CAUSA: el teléfono dice que el permiso está negado ──
        // Solo lo VISTO hace poco: si la unidad no abre la app hace dos semanas, ese estado ya no
        // dice nada de hoy (y el hueco de combustible de abajo lo agarra igual).
        const perms = await sel(`dispositivo_permisos?estado=eq.denied&select=cam,permiso,estado,navegador,visto_at`);
        for (const p of perms) {
          const cam = String(p.cam || "");
          if (!fleet.includes(cam)) continue;
          const d = -diasHasta(String(p.visto_at || "").slice(0, 10));
          if (isNaN(d) || d > 15) continue;
          const nav = String(p.navegador || "el navegador");
          if (p.permiso === "camera") {
            trabas.push(`🔴 ${Us(cam)} tiene la CÁMARA bloqueada en el teléfono (${nav})\n` +
              `   Sin cámara no puede guardar la surtida: la foto es obligatoria.\n` +
              `   👉 En SU teléfono: Ajustes → Aplicaciones → ${nav} → Permisos → Cámara → Permitir.\n` +
              `   Mientras tanto puede seguir trabajando: en la pantalla de la foto hay un botón verde\n` +
              `   «Tomar la foto con la cámara del teléfono», que no necesita ese permiso.`);
          } else {
            trabas.push(`🟡 ${Us(cam)} tiene la UBICACIÓN bloqueada en el teléfono (${nav})\n` +
              `   Las entregas y las surtidas quedan sin punto en el mapa.\n` +
              `   👉 Ajustes → Aplicaciones → ${nav} → Permisos → Ubicación → Permitir.`);
          }
        }

        // ── (b) EL HUECO: la unidad trabaja y nadie registra su combustible ──
        const surt = await selPag("surtidas", `select=cam,fecha&order=fecha.asc`);
        const ultSur: Record<string, string> = {};
        for (const s of surt) { const c = String(s.cam || ""); if (!c) continue; const f = String(s.fecha || ""); if (!ultSur[c] || f > ultSur[c]) ultSur[c] = f; }
        // ⛔ NO SE CUENTA DESDE EL PRINCIPIO DE LOS TIEMPOS. El módulo de surtidas arrancó el
        // 22/07/2026; antes de esa fecha NADIE podía registrar. Contar desde el primer día de la
        // unidad decía «B010 — 107 días trabajados y NUNCA registró», que es acusar a alguien por
        // no usar algo que no existía. El arranque se saca del dato (primera surtida de la flota),
        // no de una fecha escrita a mano: si mañana se porta a otra empresa, se ajusta solo.
        // [[norma-auditoria-precondicion-antes-de-acusar]] [[norma-el-demo-sembrado-esconde-el-camino-dia-1]]
        const arranque = surt.length ? String(surt[0].fecha || "") : "";
        if (arranque) {
          for (const cam of fleet) {
            const k = km.find((x: any) => String(x.cam || "") === cam);
            const est = String(k?.estado || "").toLowerCase();
            if (est && est !== "operativo") continue;               // parada: no se le pide combustible
            const nunca = !ultSur[cam];
            const desde = ultSur[cam] || arranque;                  // sin surtida propia: desde que el módulo existe
            // Días TRABAJADOS después de esa fecha (planillas distintas, no días de calendario:
            // un camión parado no gasta combustible).
            // Con surtida propia se cuenta DESPUÉS de ella; sin surtida, DESDE que el módulo existe
            // (restar 1 a ciegas se equivocaba los días en que la unidad no tuvo planilla).
            const dias = new Set(plan.filter((p: any) => {
              const f = String(p.f || "");
              return String(p.cam) === cam && (nunca ? f >= desde : f > desde);
            }).map((p: any) => String(p.f))).size;
            if (dias < 9) continue;
            trabas.push(nunca
              ? `⛽ ${Us(cam)} — ${dias} días trabajados y NUNCA registró una surtida (el módulo existe desde el ${fmt(arranque)})`
              : `⛽ ${Us(cam)} — ${dias} días trabajados sin registrar combustible (última surtida: ${fmt(desde)})`);
          }
        }

        if (trabas.length) {
          addBloque(`📵 El chofer no puede registrar\n\n${trabas.join("\n\n")}\n\n` +
            `👉 Esto no da error en pantalla: simplemente no entra el dato. ` +
            `Cada día sin registrar es costo de combustible que no llega a la Utilidad Real.`,
            ["admin", "operativo", "mecanica"]);
          sent.choferNoRegistra = trabas.length;
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
        addBloque(msg, ["socios", "mecanica", "operativo"]);
        sent.checklist = 1;
      }
    }

    // ── RESUMEN DEL DÍA (tarde, ~6pm) ──
    if (veHour >= 12) {
      const key = `resumen_dia_${hoyD}`;
      if (!(await yaEnviado(key, dry))) {
        const vj = await sel(`viajes_chofer?fecha=eq.${hoyD}&select=id`);
        // Combustible del día = SURTIDAS del chofer (fuente única post-corte 2026-07-18). El resumen
        // es siempre de HOY (> corte). Antes leía gasoil (despachos de oficina), que post-corte ya no
        // refleja lo surtido del día.
        const gas = await sel(`surtidas?fecha=eq.${hoyD}&select=litros`);
        const litros = gas.reduce((a: number, r: any) => a + (parseFloat(r.litros) || 0), 0);
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
        addBloque(`🔔 Resumen del día ${hoyD}\n${conDinero}`, ["socios"]);                     // socios (con dinero)
        addBloque(`🔔 Resumen del día ${hoyD}\n${base}`, ["operativo"], true);                  // Samuel (sin dinero)
        sent.resumen = 1;
      }
    }

    // ── UN SOLO ENVÍO, AL FINAL ──
    // Todo lo de arriba solo ARMÓ secciones. Aquí sale un mensaje por persona.
    // La cabecera NO repite la marca: el worker ya antepone "♻️ Betangar:" a cada mensaje.
    const destinatarios = await enviarDigest(`📅 ${fechaStr}`, wa, dry);
    sent.destinatarios = destinatarios;
    sent.secciones = bloques.length;

    return new Response(JSON.stringify({ ok: true, dry, veHour, diaSem, esDiaPlanilla, esDiaLavado, sent, srv: srv.length, lav: lav.length, sinPlan: sinPlan.length, fact: fact.length, docs: docs.length, stock: stock.length, cumpleHoy: cumpleHoy.length, fleet: fleet.length, preview: dry ? preview : undefined }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("alertas-diarias error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
