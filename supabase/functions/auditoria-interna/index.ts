import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// BETANGAR — AUDITORÍA INTERNA (cron mensual). Puerto de ~/maxware-tools/auditoria.mjs
// para que corra SOLA, sin depender del PC de Máximo.
// ═══════════════════════════════════════════════════════════════════════════════
// Detecta anomalías, dice A QUIÉN preguntar y REDACTA la pregunta.
// NO acusa a nadie: los datos dicen QUÉ pasó, solo una persona sabe POR QUÉ.
//
// Por defecto audita el MES CERRADO anterior. ?desde=&hasta= lo fuerza. ?dry=1 no envía.
//
// REGLAS DE ORO (cada una costó un bug real — no las quites):
//  1. Si no se pudo leer una fuente, ESE chequeo no emite hallazgos y se reporta como
//     "no se pudo correr". Decir "nadie cobró" porque el banco no respondió es MENTIR.
//  2. Normalizar identidades antes de comparar: las cédulas del banco traen cero a la
//     izquierda (V016352823 vs V-16352823) y los nombres vienen invertidos. Se resuelven
//     AMBOS lados contra el padrón; ante un EMPATE se devuelve null a propósito (mejor
//     "no sé quién es" que atribuirle el pago a la persona equivocada).
//  3. Separar el ruido sistémico de la anomalía: una diferencia UNIFORME en todos es la
//     TASA, no un error. Sin ese filtro el reporte se llena de falsos positivos.
//  4. Paginar: Supabase corta en 1000 filas EN SILENCIO.
//  5. Idempotente: cada hallazgo se avisa UNA vez por período (alertas_log).
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// AUREDY MEDINA (E002, 584120276883) salió de la lista: baja del 06/08/2026.
// ⛔ Quien recibe se lee de la base (roles `socios` y `rrhh`), no se clava acá.
//    La linea de arriba —la baja de Auredy anotada a mano el 06/08— es exactamente
//    el trabajo que esto viene a eliminar.
// ⚠️ Si la base no contesta se usa el numero de Maximo: una auditoria que no llega
//    es una auditoria que no existe, y el silencio no se nota.
// ⚠️ El respaldo es SOLO Maximo. Gladys arranca vacia a proposito: esta auditoria
//    lleva datos de NOMINA, y si la base no contesta no se puede saber si quien
//    ocupaba RRHH sigue ahi. A el le corresponde siempre; a un puesto, no.
let MAXIMO = "584147379886", GLADYS = "";
async function cargarDestinatarios(): Promise<void> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/destinatarios`,
      { method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
        body: JSON.stringify({ p_roles: ["socios", "rrhh"] }) });
    const j = await r.json();
    if (Array.isArray(j)) {
      const soc = j.filter((d: any) => d.rol === "socios").map((d: any) => String(d.telefono));
      const rh  = j.filter((d: any) => d.rol === "rrhh").map((d: any) => String(d.telefono));
      if (soc.length) MAXIMO = soc[0];
      GLADYS = rh.length ? rh[0] : "";   // vacio = RRHH sin nadie: no se manda a ciegas
    }
  } catch (e) { console.error("destinatarios() no contesto, se usa el respaldo:", e); }
}

const rest = async (q: string): Promise<any[]> => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: HDR });
  if (!r.ok) throw new Error(`${q}: ${r.status}`);
  return await r.json();
};
async function restAll(q: string, orden = "id"): Promise<any[]> {
  const todo: any[] = []; const paso = 1000;
  for (let d = 0; ; d += paso) {
    const sep = q.includes("?") ? "&" : "?";
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}${sep}order=${orden}`, { headers: { ...HDR, Range: `${d}-${d + paso - 1}` } });
    const lote = await r.json();
    if (!Array.isArray(lote) || !lote.length) break;
    todo.push(...lote);
    if (lote.length < paso) break;
  }
  return todo;
}
const ced = (s: unknown) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");
const norm = (s: unknown) => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
const toks = (s: unknown) => norm(s).split(" ").filter((t) => t.length >= 4);
const bs = (n: number) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2 });
const dMas = (f: string, n: number) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ddmm = (s: string) => { const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };

type Hallazgo = { tipo: string; sev: string; titulo: string; detalle: string; quien: string; pregunta: string };

// ⛔ ESTA FUNCIÓN NO PEDÍA NADA PARA ENTRAR, Y CORRE CON service_role.
// Revisión de seguridad del 09/08: el candado que se puso hoy en la base (btg_ve_financiero) deja
// pasar a `service_role` a propósito, porque la auditoría tiene que leer lo que audita. Pero como
// acá no se comprobaba QUIÉN llamaba, `?dry=1` devolvía `msgDir` entero —cobrado, gasto, utilidad
// real y estimada, márgenes, brecha cambiaria, y hallazgos con nombres de empleados y montos— a
// cualquiera. O sea: el candado de la base se saltaba por HTTP. El `verify_jwt` tampoco protegía:
// la llave `anon` está publicada en el sitio y vale hasta 2036.
// [[norma-seguridad-dos-niveles]] · [[norma-barrido-no-es-candado]]
const FN_SECRET = Deno.env.get("BTG_FN_SECRET") || "";
function autorizado(req: Request): boolean {
  if (!FN_SECRET) return false;            // sin secreto configurado NO se abre: fail-closed
  const k = req.headers.get("x-api-key") || "";
  if (k.length !== FN_SECRET.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ FN_SECRET.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  // ⛔ Lo primero: traer de la base a quien le toca recibir esta auditoria.
  await cargarDestinatarios();
  if (!autorizado(req)) {
    return new Response(JSON.stringify({ error: "No autorizado" }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }
  try {
    const qs = new URL(req.url).searchParams;
    const dry = qs.get("dry") === "1";
    // Mes CERRADO anterior (el cron corre el día 1).
    const hoyVE = new Date(Date.now() - 4 * 3600 * 1000);
    const y = hoyVE.getUTCFullYear(), m = hoyVE.getUTCMonth();
    const prev = new Date(Date.UTC(y, m - 1, 1));
    const DESDE = qs.get("desde") || prev.toISOString().slice(0, 10);
    const HASTA = qs.get("hasta") || new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

    const HALLAZGOS: Hallazgo[] = [];
    const NO_CORRIDOS: string[] = [];
    const add = (tipo: string, sev: string, titulo: string, detalle: string, quien: string, pregunta: string) =>
      HALLAZGOS.push({ tipo, sev, titulo, detalle, quien, pregunta });

    const EMP = await rest("empleados?select=nombre,cedula,cargo,activo");
    const porCed: Record<string, any> = {};
    EMP.forEach((e) => { const c = ced(e.cedula); if (c) porCed[c] = e; });
    const resolver = (n: unknown) => {
      const T = toks(n); if (!T.length) return null;
      const punt = EMP.map((e) => ({ e, k: T.filter((t) => toks(e.nombre).includes(t)).length }))
        .filter((x) => x.k >= 2).sort((a, b) => b.k - a.k || a.e.nombre.localeCompare(b.e.nombre));
      if (!punt.length) return null;
      if (punt.length > 1 && punt[1].k === punt[0].k) return null;   // empate → ambiguo, no se adivina
      return punt[0].e;
    };

    // ═══ D. PERÍODOS DUPLICADOS ═══
    const NH = await rest("nomina_historial?select=id,semana,fecha_desde,fecha_hasta,total_usd,detalle");
    const conFecha = NH.filter((n) => n.fecha_desde && n.fecha_hasta);
    for (let i = 0; i < conFecha.length; i++) for (let j = i + 1; j < conFecha.length; j++) {
      const a = conFecha[i], b = conFecha[j];
      if (a.fecha_desde <= b.fecha_hasta && b.fecha_desde <= a.fecha_hasta)
        add("D", "🔴", "Dos nóminas cubren el mismo período",
          `"${a.semana}" (${a.fecha_desde}→${a.fecha_hasta}, $${a.total_usd}) y "${b.semana}" (${b.fecha_desde}→${b.fecha_hasta}, $${b.total_usd}). La Utilidad Real suma TODAS las filas → ese período se descuenta dos veces.`,
          "Decisión interna", "Hay que decidir cuál se conserva (la más completa) y borrar la otra.");
    }
    const sinFecha = NH.filter((n) => !n.fecha_desde);
    if (sinFecha.length) add("D", "🟡", `${sinFecha.length} nóminas sin fechas`,
      `${sinFecha.map((n) => n.semana).join(", ")}. Sin fechas no se sabe si solapan → podría haber más duplicados invisibles.`,
      "Decisión interna", "Ponerles el período real o decidir si se descartan.");

    // ═══ E. PERÍODOS SIN CERRAR ═══
    const ultNom = conFecha.map((n) => n.fecha_hasta).sort().pop() || "2000-01-01";
    const planPend = await restAll(`planillas?f=gt.${ultNom}&select=f,t,m`);
    if (planPend.length) {
      const dias = [...new Set(planPend.map((p) => String(p.f).slice(0, 10)))].sort();
      const semanas = Math.max(1, Math.round((+new Date(dias[dias.length - 1]) - +new Date(dias[0])) / 604800000) + 1);
      add("E", "🔴", `${semanas} semana(s) de planillas sin nómina guardada`,
        `Última nómina cerrada: ${ultNom}. Hay ${planPend.length} planillas después (hasta ${dias[dias.length - 1]}). Mientras no se guarden, la Utilidad Real está INFLADA.`,
        "Dirección / Administración", "Cerrar esas semanas en el módulo Nómina.");
    }

    // ═══ Chequeos que necesitan el BANCO ═══
    let movs: any[] | null = [];
    try {
      const rs = await fetch(`${SUPABASE_URL}/functions/v1/bnc-saldo`, {
        method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saldo" }), signal: AbortSignal.timeout(30000),
      });
      const ds = await rs.json();
      if (!ds?.ok || !Object.keys(ds.saldos || {}).length) throw new Error(ds?.respuesta?.message || "el BNC no respondió");
      const vent: string[][] = []; let ini = DESDE;
      while (ini <= HASTA) { let fin = dMas(ini, 29); if (fin > HASTA) fin = HASTA; vent.push([ini, fin]); ini = dMas(fin, 1); }
      for (const acc of Object.keys(ds.saldos)) for (const [d, h] of vent) {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/bnc-saldo`, {
          method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "movimientos_fecha", account_number: acc, start_date: d, end_date: h }),
          signal: AbortSignal.timeout(40000),
        });
        const dm = await r.json();
        if (!dm?.ok || !Array.isArray(dm.movimientos)) throw new Error(`no se pudo leer la cuenta ${acc} (${d}→${h})`);
        movs!.push(...dm.movimientos);
      }
    } catch (e) {
      movs = null;
      NO_CORRIDOS.push(`A, B, C, F, G, H — no se pudo leer el banco: ${(e as Error).message}`);
    }

    if (movs) {
      const pagos: any[] = [];
      for (const m of movs) {
        if (!String(m.BalanceDelta || "").toLowerCase().includes("egreso")) continue;
        const tipo = String(m.Type || ""); if (/Comisi/i.test(tipo) || /entre Ctas/i.test(tipo)) continue;
        const cpt = String(m.Concept || "").replace(/\s+/g, " ").trim();
        const s = cpt.match(/SEM\s*(\d+)/i); if (!s) continue;
        let emp = null, etiqueta = null;
        const c = cpt.match(/CED\.?:?\s*[VEJ]?(\d{6,10})/i);
        if (c) { emp = porCed[ced(c[1])] || null; if (!emp) etiqueta = "CED " + c[1]; }
        if (!emp) { const nm = cpt.match(/A FAVOR DE:\s*(.+?)\s+PARA LA CUENTA/i); if (nm) { emp = resolver(nm[1]); if (!emp) etiqueta = nm[1].trim(); } }
        pagos.push({ sem: +s[1], emp, etiqueta, bs: Math.round(parseFloat(m.Amount || 0) * 100) / 100 });
      }

      // ── F. Pagos no trazables ──
      const noTraz: Record<string, number> = {};
      pagos.filter((p) => !p.emp).forEach((p) => { const k = p.etiqueta || "(sin identificar)"; noTraz[k] = (noTraz[k] || 0) + p.bs; });
      if (Object.keys(noTraz).length) add("F", "🟡", `${Object.keys(noTraz).length} pagos que no casan con ningún empleado`,
        Object.entries(noTraz).sort((a, b) => b[1] - a[1]).map(([k, v]) => `   ${k} — Bs ${bs(v)}`).join("\n"),
        "RRHH (Gladys)", "¿Quiénes son? Probablemente les falta cargar la cédula en el padrón, y por eso ningún pago suyo se puede rastrear.");

      // ── G. Inactivos que cobran ──
      const inact: Record<string, number> = {};
      pagos.filter((p) => p.emp && p.emp.activo === false).forEach((p) => { inact[p.emp.nombre] = (inact[p.emp.nombre] || 0) + p.bs; });
      if (Object.keys(inact).length) add("G", "🔴", `${Object.keys(inact).length} persona(s) marcada(s) INACTIVA cobraron`,
        Object.entries(inact).sort((a, b) => b[1] - a[1]).map(([k, v]) => `   ${k} — Bs ${bs(v)}`).join("\n"),
        "RRHH (Gladys)", "¿Siguen trabajando (y hay que reactivarlos) o fue una liquidación / pago pendiente?");

      // ── A. Cobró sin estar en ninguna planilla ──
      const plan = await restAll(`planillas?f=gte.${DESDE}&f=lte.${HASTA}&select=ch,ay1,ay2,ay3,ap1,ap2`);
      const enPlanilla = new Set<string>();
      plan.forEach((p) => [p.ch, p.ay1, p.ay2, p.ay3, p.ap1, p.ap2].forEach((n) => { const e = n && resolver(n); if (e) enPlanilla.add(e.nombre); }));
      const sinPlan: Record<string, number> = {};
      pagos.filter((p) => p.emp && !enPlanilla.has(p.emp.nombre) && /ayudante|chofer/i.test(p.emp.cargo || ""))
        .forEach((p) => { sinPlan[p.emp.nombre] = (sinPlan[p.emp.nombre] || 0) + p.bs; });
      if (Object.keys(sinPlan).length) {
        const tot = Object.values(sinPlan).reduce((a, b) => a + b, 0);
        add("A", "🔴", `${Object.keys(sinPlan).length} chofer/ayudante cobraron sin aparecer en ninguna planilla`,
          Object.entries(sinPlan).sort((a, b) => b[1] - a[1]).map(([k, v]) => `   ${k} — Bs ${bs(v)}`).join("\n") + `\n   TOTAL: Bs ${bs(tot)} sin respaldo operativo.`,
          "RRHH (Gladys)", "¿Están trabajando y no se les anota en la planilla (¿son de APOYO? van en los campos Apoyo 1 y 2), o cobran por otro concepto?");
      }

      // ── B y C: nómina guardada vs banco ──
      // El ancla de la numeración "SEM n" se DEDUCE de los datos (es propia de Betangar, no ISO).
      const conNum = NH.filter((n) => /^SEM-\d+$/.test(n.semana || "") && n.fecha_desde);
      const anclas = new Set(conNum.map((n) => Math.round((+new Date(n.fecha_desde + "T12:00:00Z") - +new Date("2000-01-03T12:00:00Z")) / 86400000) - parseInt(n.semana.slice(4)) * 7));
      if (anclas.size !== 1) {
        NO_CORRIDOS.push(`B y C — la numeración de semanas no es consistente (${anclas.size} anclas), no se puede cruzar con el banco sin adivinar.`);
      } else {
        const ancla = [...anclas][0];
        const semDe = (f: string) => Math.round((+new Date(f + "T12:00:00Z") - +new Date("2000-01-03T12:00:00Z")) / 86400000 - ancla) / 7;
        const noCobro: string[] = [], fuerte: string[] = [], leve: string[] = [];
        for (const nom of NH.filter((n) => n.fecha_desde && n.fecha_hasta && n.fecha_desde <= HASTA && n.fecha_hasta >= DESDE)) {
          const sem = semDe(nom.fecha_desde); if (!Number.isInteger(sem)) continue;
          const pagosSem = pagos.filter((p) => p.sem === sem && p.emp); if (!pagosSem.length) continue;
          const porPersona: Record<string, number> = {};
          pagosSem.forEach((p) => { porPersona[p.emp.nombre] = (porPersona[p.emp.nombre] || 0) + p.bs; });
          const det = nom.detalle || {}; const gente: any[] = [];
          for (const k of ["choferes", "ayudantes", "adm"]) for (const e of (det[k] || [])) {
            let n2 = e.n; const par = String(n2).match(/\(([^)]+)\)/); if (par) n2 = par[1];
            const emp = resolver(n2); if (emp) gente.push({ nombre: emp.nombre, bs: parseFloat(e.bs) || 0 });
          }
          const cuenta: Record<string, number> = {};
          gente.filter((g) => porPersona[g.nombre] && g.bs > 0).forEach((g) => { const r = (porPersona[g.nombre] / g.bs).toFixed(4); cuenta[r] = (cuenta[r] || 0) + 1; });
          const [dom, veces] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || [null, 0];
          for (const g of gente) {
            const pagado = porPersona[g.nombre];
            if (!pagado) { noCobro.push(`${g.nombre} — ${nom.semana}: la nómina dice Bs ${bs(g.bs)}`); continue; }
            if (veces >= 3 && g.bs > 0 && Math.abs(pagado / g.bs - +dom!) > 0.005) {
              const pct = (pagado / g.bs - 1) * 100;
              (Math.abs(pct) >= 15 ? fuerte : leve).push(`${g.nombre} — ${nom.semana}: nómina Bs ${bs(g.bs)} vs banco Bs ${bs(pagado)} (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`);
            }
          }
        }
        if (noCobro.length) add("B", "🟡", `${noCobro.length} persona(s) en la nómina que el banco NO les pagó`,
          noCobro.map((x) => "   " + x).join("\n"), "Administración", "¿Se les pagó por otra vía (efectivo, otro banco) o quedó pendiente?");
        if (fuerte.length) add("C", "🔴", `${fuerte.length} pago(s) MUY distintos a lo calculado (más de 15%)`,
          fuerte.map((x) => "   " + x).join("\n") + "\n   (el efecto del tipo de cambio ya está descontado)",
          "Administración", "¿Fue un bono, un adelanto, una corrección de otra semana, o un error?");
        if (leve.length) add("C", "🟡", `${leve.length} pago(s) con diferencia pequeña (menos de 15%)`,
          leve.slice(0, 12).map((x) => "   " + x).join("\n") + (leve.length > 12 ? `\n   …y ${leve.length - 12} más` : "") +
          "\n   Probablemente se pagó otro día (otra tasa) o en dos partes.",
          "Administración", "Confirmar que sean diferencias de fecha de pago y no ajustes sin registrar.");
      }

      // ── H. Trabajó y no cobró ──
      const cobraron = new Set(pagos.filter((p) => p.emp).map((p) => p.emp.nombre));
      const sinPago = [...enPlanilla].filter((n) => !cobraron.has(n));
      if (sinPago.length) add("H", "🟡", `${sinPago.length} persona(s) trabajaron y no se les ve pago`,
        sinPago.map((n) => "   " + n).join("\n"), "Administración", "¿Se les pagó por otra vía o quedó pendiente?");
    }

    // ═══ ENVÍO ═══ (idempotente por hallazgo y período)
    const orden: Record<string, number> = { "🔴": 0, "🟡": 1 };
    HALLAZGOS.sort((a, b) => orden[a.sev] - orden[b.sev]);
    const clave = (h: Hallazgo) => `audit_${h.tipo}_${DESDE}_${HASTA}_${norm(h.titulo).slice(0, 40).replace(/\s/g, "_")}`;
    const nuevos: Hallazgo[] = [];
    for (const h of HALLAZGOS) {
      const r = await rest(`alertas_log?alert_key=eq.${encodeURIComponent(clave(h))}&select=alert_key`);
      if (!r.length) nuevos.push(h);
    }
    if (!nuevos.length) return json({ ok: true, periodo: [DESDE, HASTA], hallazgos: HALLAZGOS.length, nuevos: 0, msg: "nada nuevo que avisar" });

    const fecha = `${ddmm(DESDE)} al ${ddmm(HASTA)}`;

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // EL RESULTADO DEL MES Y LO QUE COSTÓ EL CAMBIO
    // Máximo (09/08): «cuando la IA haga el análisis en su momento mensual que lo tome en cuenta
    // ese factor para dar los consejos».
    //
    // ⛔ LOS CONSEJOS SALEN DE LOS DATOS, NO DE UNA PLANTILLA. Se comparan las dos piezas del
    // diferencial contra el mes anterior y solo se dice algo cuando hay algo que decir. Un
    // consejo que aparece todos los meses diga lo que digan los números deja de leerse.
    //
    // ⚠️ Si algo de esto falla, NO se inventa: el bloque no sale y el resto del informe va igual.
    // Regla de oro 1 de esta función. [[norma-numero-que-el-dueno-no-puede-explicar]]
    // ══════════════════════════════════════════════════════════════════════════════════════════
    let bloqueFin = "";
    try {
      const rpc = async (fn: string, body: unknown) => {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
          method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`${fn}: ${r.status}`);
        const j = await r.json(); return Array.isArray(j) ? j : [j];
      };
      const res = (await rpc("btg_resumen_socio", { p_desde: DESDE, p_hasta: HASTA }))[0];
      const camb = await rpc("btg_cambiario_mensual", { p_desde: DESDE, p_hasta: HASTA });
      const usd = (n: unknown) => "$" + Math.round(Number(n) || 0).toLocaleString("es-VE");
      const mes = camb[camb.length - 1];

      bloqueFin = `\n\n━━━━━━━━━━━━━━━\n💰 *EL RESULTADO DEL PERÍODO*\n` +
        `Cobrado ${usd(res?.cobrado_usd)} · Gasto ${usd(res?.gasto_usd)}\n` +
        `*Utilidad REAL ${usd(res?.utilidad_usd)}* (margen ${res?.margen_pct ?? 0}%)`;

      // ── LA REAL Y LA ESTIMADA ────────────────────────────────────────────────────────────
      // Máximo: los viajes ejecutados y no facturados «en algún momento son utilidad, solo que
      // no es la real». Es cierto y por una razón concreta: los gastos de esos viajes YA están
      // restados en la utilidad real —nómina, combustible, mantenimiento— y su ingreso no entró.
      // La real está subestimada: carga el costo de un trabajo cuyo cobro no aparece todavía.
      // Se dicen LAS DOS y la estimada va marcada: no se factura hasta el momento del pago.
      try {
        const e = (await rpc("btg_utilidad_real_y_estimada", { p_desde: DESDE, p_hasta: HASTA }))[0];
        if (e && Number(e.por_facturar_usd) > 0) {
          bloqueFin += `\n\n📈 *Y lo que ya se trabajó y no se ha facturado*\n` +
            `${e.viajes_sin_facturar} viajes × $${e.tarifa_usada} = *${usd(e.por_facturar_usd)}*\n` +
            `Los gastos de esos viajes YA están restados arriba: se pagó nómina, combustible y mantenimiento para hacerlos. Lo que falta es el cobro.\n` +
            `➜ *Utilidad ESTIMADA ${usd(e.utilidad_estimada_usd)}* (margen ${e.margen_estimado_pct}%) — lo que quedaría cuando se facture y se cobre.\n` +
            `_⚠️ Es un estimado, no una certeza. ${e.supuestos} Y no se factura hasta el momento del pago, así que no se sabe cuándo entra._`;
        }
      } catch (e2) { console.error("utilidad estimada", String(e2)); }

      if (mes && Number(mes.total_usd) > 0) {
        bloqueFin += `\n\n📉 *Lo que costó el cambio:* ${usd(mes.total_usd)} — el *${Number(mes.pct_del_cobrado).toFixed(2)}%* de lo cobrado\n` +
          `  • bolívares quietos perdiendo valor: ${usd(mes.parados_usd)}\n` +
          `  • sobreprecio al comprar dólares: ${usd(mes.sobreprecio_usd)}`;
        if (Number(mes.compras) > 0) {
          bloqueFin += `\n  • la brecha de las ${mes.compras} compra(s) fue de *${mes.brecha_min_pct}% a ${mes.brecha_max_pct}%* sobre el BCV`;
        }

        // ── LOS CONSEJOS: cada uno solo si los números lo justifican ──
        const tips: string[] = [];
        const ant = camb.length > 1 ? camb[camb.length - 2] : null;

        // 1. ¿la brecha empeoró o mejoró contra el mes pasado?
        if (ant && Number(ant.compras) > 0 && Number(mes.compras) > 0) {
          const d = Number(mes.brecha_max_pct) - Number(ant.brecha_max_pct);
          if (d >= 5) tips.push(`La brecha subió ${d.toFixed(0)} puntos contra el mes pasado (de ${ant.brecha_max_pct}% a ${mes.brecha_max_pct}%). Cada dólar que se compre ahora cuesta más: si la compra puede esperar, conviene esperar.`);
          else if (d <= -5) tips.push(`La brecha bajó ${Math.abs(d).toFixed(0)} puntos contra el mes pasado (de ${ant.brecha_max_pct}% a ${mes.brecha_max_pct}%). Es el momento más barato en meses para comprar dólares.`);
        }
        // 2. ¿se compró fuerte justo cuando estaba caro?
        if (Number(mes.sobreprecio_usd) > Number(mes.parados_usd) * 5 && Number(mes.brecha_max_pct) >= 25) {
          tips.push(`Casi todo el costo del cambio (${usd(mes.sobreprecio_usd)}) es sobreprecio de compra con la brecha en ${mes.brecha_max_pct}%. Repartir las compras en varias fechas suele salir más barato que concentrarlas.`);
        }
        // 3. ¿hay plata quieta perdiendo valor?
        if (Number(mes.parados_usd) > Number(mes.sobreprecio_usd) && Number(mes.parados_usd) > 500) {
          tips.push(`Este mes se perdió más por tener bolívares quietos (${usd(mes.parados_usd)}) que por el precio del dólar. Mover la plata antes —pagar o convertir— es lo que lo reduce.`);
        }
        // 4. el peso sobre el resultado
        if (Number(res?.utilidad_usd) > 0 && Number(mes.total_usd) / Number(res.utilidad_usd) > 0.15) {
          tips.push(`El cambio se llevó el ${(Number(mes.total_usd) / Number(res.utilidad_usd) * 100).toFixed(0)}% de la utilidad del período.`);
        }
        if (tips.length) bloqueFin += `\n\n💡 *Para tener en cuenta*\n` + tips.map((t) => "• " + t).join("\n");
      }
      if (Number(res?.divisas_sin_valuar) > 0) {
        bloqueFin += `\n\n⚠️ Hay ${res.divisas_sin_valuar} compra(s) de dólares *sin su tasa*: no se pueden valuar y quedan fuera de estos números. Hay que preguntar a cuánto se compró.`;
      }
    } catch (e) {
      console.error("bloque financiero", String(e));
      NO_CORRIDOS.push("el resumen financiero del período — no se pudo calcular");
    }
    const deGladys = nuevos.filter((h) => /RRHH/i.test(h.quien));
    const msgDir = `🔎 *Auditoría interna — Betangar*\n_Período ${fecha}_\n\n` +
      nuevos.map((h) => `${h.sev} *${h.titulo}*\n${h.detalle.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")}\n_Preguntarle a: ${h.quien}_`).join("\n\n") +
      (NO_CORRIDOS.length ? `\n\n⛔ *No se pudieron correr:* ${NO_CORRIDOS.join(" | ")}` : "") +
      (deGladys.length ? `\n\n📩 A Gladys se le enviaron ${deGladys.length} pregunta(s) de RRHH.` : "") +
      bloqueFin +
      // ⛔ NUNCA NOMBRAR AL DUEÑO EN TERCERA PERSONA EN UN INFORME. Acá decía «Este resumen le
      // llegó a Máximo». Él es quien FIRMA estos informes: una frase que habla de él como de un
      // tercero delata que no los escribió, que es exactamente lo que no puede pasar.
      // Vale para todo lo que sale a pantalla, papel o WhatsApp.
      // [[norma-nada-que-insinue-ia-al-cliente]] · [[norma-no-nombrar-al-dueno-en-tercera-persona]]
      `\n\n_Copia enviada a la dirección._`;
    // A Gladys: solo nombres, SIN montos. Para contestar "¿está trabajando o cobra por otro
    // concepto?" no hace falta el monto, y así no se pasea plata de la gente por WhatsApp.
    const msgGladys = deGladys.length ? `Hola Gladys 👋\n\nRevisando los números de nómina del *${fecha}* nos quedaron unas dudas que solo tú nos puedes aclarar:\n\n` +
      deGladys.map((h, i) => `*${i + 1}.* ${h.titulo}\n${h.detalle.split("\n").map((l) => l.trim()).filter((l) => l.includes("—")).map((l) => "• " + l.split("—")[0].trim()).join("\n")}\n\n${h.pregunta}`).join("\n\n───────\n\n") +
      `\n\nCon tus respuestas dejamos el sistema al día. ¡Gracias! 🙏` : null;

    // `dry` sirve para probar que la auditoría CORRE sin mandarle nada a nadie. Para eso alcanza
    // con cuántos hallazgos salieron y de qué tipo. Devolver los mensajes enteros metía el estado de
    // resultados y los nombres con montos en el cuerpo de la respuesta — defensa en profundidad:
    // aunque el secreto se filtre, `dry` ya no es un volcado.
    if (dry) return json({ ok: true, dry: true, periodo: [DESDE, HASTA], nuevos: nuevos.length,
      no_corridos: NO_CORRIDOS, tipos: nuevos.map((h) => h.tipo), a_gladys: deGladys.length,
      largo_msg: msgDir.length });

    const cola: any[] = []; const yaVa = new Set<string>();
    // Baja 06/08/2026 — AUREDY MEDINA (E002) dejó la empresa; el resumen con montos ya no le llega.
    for (const n of [MAXIMO]) if (n && !yaVa.has(n)) { yaVa.add(n); cola.push({ telefono: n, mensaje: msgDir, tipo: "auditoria", estado: "pendiente" }); }
    // ⚠️ Sin el `GLADYS &&` esto encolaba un mensaje con telefono vacio el dia que
    //    RRHH no tuviera a nadie en la base: se perdia en la cola sin dejar rastro.
    if (GLADYS && msgGladys && !yaVa.has(GLADYS)) { yaVa.add(GLADYS); cola.push({ telefono: GLADYS, mensaje: msgGladys, tipo: "auditoria", estado: "pendiente" }); }
    else if (!GLADYS && msgGladys) console.error("AUDITORIA: hay hallazgos de RRHH y no hay nadie con rol `rrhh` en configuracion.whatsapp — el mensaje NO sale");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
      method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(cola),
    });
    if (!r.ok) return json({ ok: false, error: "no se pudo encolar: " + (await r.text()).slice(0, 200) });
    // Solo se marcan como avisados si el encolado SÍ funcionó (nada de éxito falso).
    for (const h of nuevos) await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
      method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ alert_key: clave(h) }),
    });
    return json({ ok: true, periodo: [DESDE, HASTA], nuevos: nuevos.length, avisados: cola.length, no_corridos: NO_CORRIDOS });
  } catch (e) {
    console.error("auditoria-interna", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});

function json(b: unknown) { return new Response(JSON.stringify(b, null, 2), { headers: { "Content-Type": "application/json" } }); }
