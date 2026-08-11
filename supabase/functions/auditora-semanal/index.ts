import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BETANGAR — RECORDATORIO SEMANAL A LA AUDITORA (lunes, 9:00 am VE)
//
// Pedido de Máximo (2026-08-11): «un mensaje automático todos los lunes donde le recuerdes revisar
// y auditar todo, para que no se le acumule el trabajo y que lo que necesite sea más fácil y fresco
// para la administradora facilitárselo».
//
// ⛔ POR QUÉ NO ES UN RECORDATORIO PELADO. «Acordate de auditar» todos los lunes es ruido: a la
// tercera semana nadie lo lee ([[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]). El mensaje
// lleva **lo que el sistema tiene pendiente de explicar ESTA semana**, con su antigüedad. Eso es
// justo lo que hace la diferencia para la administración: un movimiento del banco de hace 3 días
// se explica de memoria; el mismo movimiento dentro de dos meses hay que ir a buscarlo.
//
// La semana reportada es **lunes a domingo** — la semana real, no un bloque de días
// ([[norma-semana-real-no-bloque-de-dias]]).
//
// Solo ENCOLA en `cola_mensajes`; el worker `procesar_cola_wassenger` antepone la etiqueta de la
// empresa y envía. Candado COMPARTIDO en `alertas_log.alert_key` (UNIQUE): si el cron se dispara
// dos veces o alguien la invoca a mano, se manda UNA sola vez.
//
//   ?dry=1              arma el mensaje y lo devuelve SIN encolar ni marcar
//   ?lunes=YYYY-MM-DD   reporta la semana que arranca ese lunes (para reenviar o probar)
// ══════════════════════════════════════════════════════════════════════════════════════════════

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
function dmy(s: string): string { const p = String(s).slice(0, 10).split("-"); return `${p[2]}/${p[1]}/${p[0]}`; }
function dias(desdeISO: string): number {
  return Math.round((Date.parse(ymd(veNow()) + "T12:00:00Z") - Date.parse(String(desdeISO).slice(0, 10) + "T12:00:00Z")) / 86400000);
}
function n(x: number): string { return Number(x || 0).toLocaleString("es-VE"); }

// Candado COMPARTIDO: el UNIQUE de alert_key hace que solo UNA corrida gane.
async function tomarCandado(key: string, dry: boolean): Promise<boolean> {
  const rows = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  if (rows.length) return false;
  if (dry) return true;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
  return r.ok;
}

// ⛔ EL TELÉFONO NO VA ESCRITO ACÁ. Sale de `configuracion.auditor_tel`, y si esa clave no está,
// de la ficha de la persona con cargo de auditor en `empleados`. Un número quemado en el código
// sobrevive a la persona: el día que cambie la auditora, esta función le seguiría escribiendo a la
// anterior. [[norma-fuente-unica-datos]]
async function destinataria(): Promise<{ tel: string; nombre: string; motivo: string } | { error: string }> {
  const cfg = await sel(`configuracion?clave=eq.auditor_tel&select=valor`);
  const deCfg = String(cfg[0]?.valor || "").trim();
  const emps = await sel(`empleados?cargo=ilike.*auditor*&activo=is.true&select=id,nombre,tel,whatsapp`);

  if (deCfg) {
    const e = emps[0];
    return { tel: deCfg, nombre: e ? String(e.nombre) : "", motivo: "configuracion.auditor_tel" };
  }
  // ⚠️ Si hay DOS auditoras activas, la función NO elige: se calla y lo dice. Un sistema que
  // adivina a cuál de las dos mandarle un informe interno es peor que uno que no manda nada.
  // [[norma-nombre-corto-que-apunta-a-dos-personas]]
  if (emps.length > 1) return { error: `hay ${emps.length} empleados activos con cargo de auditor; definí configuracion.auditor_tel` };
  if (!emps.length) return { error: "no hay ningún empleado activo con cargo de auditor, ni configuracion.auditor_tel" };
  const tel = String(emps[0].whatsapp || emps[0].tel || "").trim();
  if (!tel) return { error: `${emps[0].nombre} no tiene teléfono cargado en su ficha` };
  return { tel, nombre: String(emps[0].nombre), motivo: `empleados.${emps[0].id}` };
}

Deno.serve(async (_req: Request) => {
  try {
    const url = new URL(_req.url);
    const dry = url.searchParams.get("dry") === "1";
    const lunesParam = url.searchParams.get("lunes");

    // Semana REPORTADA = lunes a domingo ANTERIORES al lunes en que corre.
    const hoy = veNow();
    const lunesEstaSem = new Date(hoy);
    lunesEstaSem.setUTCDate(lunesEstaSem.getUTCDate() - ((lunesEstaSem.getUTCDay() + 6) % 7));
    const ini = lunesParam ? new Date(lunesParam + "T12:00:00Z") : new Date(lunesEstaSem.getTime() - 7 * 86400000);
    const fin = new Date(ini.getTime() + 6 * 86400000);      // domingo
    const desde = ymd(ini), hasta = ymd(fin);

    const key = `auditora_semanal_${desde}`;
    if (!(await tomarCandado(key, dry))) {
      return new Response(JSON.stringify({ ok: true, skip: "ya enviado", key }), { headers: { "Content-Type": "application/json" } });
    }

    const dest = await destinataria();
    if ("error" in dest) {
      return new Response(JSON.stringify({ ok: false, error: dest.error }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── LO QUE ESTÁ PENDIENTE DE EXPLICAR ──────────────────────────────────────────────────────
    // No se acota al período: lo viejo es justo lo que hay que sacar antes de que nadie recuerde
    // de qué se trataba. Pero SÍ se dice cuánto de eso es de esta semana y cuán viejo es lo peor.
    const movsPend = await sel(`bnc_movimientos?or=(categoria.eq.sin_clasificar,categoria.eq.%E2%8F%B3pendiente_explicar)&select=fecha&order=fecha.asc`);
    const movSemana = movsPend.filter((m: any) => String(m.fecha) >= desde && String(m.fecha) <= hasta).length;
    const movViejo = movsPend.length ? String(movsPend[0].fecha).slice(0, 10) : "";

    const cxpSinSop = await sel(`cxp?sin_soporte=is.true&select=fecha,prov_nombre&order=fecha.asc`);
    const anomAb = await sel(`anomalias?estado=eq.abierta&select=cam,critico`);
    const anomCrit = anomAb.filter((a: any) => a.critico === true).length;
    const osAbiertas = await sel(`ordenes_servicio?or=(estado.eq.emitida,estado.eq.en_proceso)&select=id`);

    const plSem = await sel(`planillas?f=gte.${desde}&f=lte.${hasta}&select=p,f,ay1,ay2,ay3`);
    const plSinAy = plSem.filter((p: any) =>
      !String(p.ay1 || "").trim() && !String(p.ay2 || "").trim() && !String(p.ay3 || "").trim()).length;

    // ── LO QUE SE MOVIÓ EN LA SEMANA ───────────────────────────────────────────────────────────
    const surt = await sel(`surtidas?fecha=gte.${desde}&fecha=lte.${hasta}&select=litros`);
    const litros = surt.reduce((s: number, x: any) => s + (Number(x.litros) || 0), 0);
    const abo = await sel(`abonos?f=gte.${desde}&f=lte.${hasta}&select=id`);
    const cxpSem = await sel(`cxp?fecha=gte.${desde}&fecha=lte.${hasta}&select=id`);

    // ── EL MENSAJE ─────────────────────────────────────────────────────────────────────────────
    const pend: string[] = [];
    if (movsPend.length) {
      pend.push(`⚠️ *${n(movsPend.length)} movimiento(s) del banco sin clasificar*` +
        (movSemana ? ` — ${movSemana} son de esta semana` : "") +
        (movViejo ? `; el más viejo es del ${dmy(movViejo)} (${dias(movViejo)} días).` : ".") +
        `\n    👉 Relación de gastos → «⚠️ Por revisar»`);
    }
    if (cxpSinSop.length) {
      pend.push(`📄 *${n(cxpSinSop.length)} cuenta(s) por pagar marcadas SIN SOPORTE*` +
        `; la más vieja es del ${dmy(cxpSinSop[0].fecha)}.\n    👉 Cuentas x Pagar`);
    }
    if (plSinAy) pend.push(`🧾 *${plSinAy} planilla(s) de la semana sin ningún ayudante anotado.*\n    👉 Es de donde salen los reclamos de nómina.`);
    if (anomAb.length) pend.push(`🔧 *${n(anomAb.length)} falla(s) de unidad abiertas*` + (anomCrit ? ` (${anomCrit} críticas).` : ".") + `\n    👉 Km / Servicio y Unidades`);
    if (osAbiertas.length) pend.push(`🛠️ *${n(osAbiertas.length)} orden(es) de servicio sin cerrar.*`);

    let msg = `🔍 *REVISIÓN SEMANAL*\nSemana del ${dmy(desde)} al ${dmy(hasta)}\n\n` +
      `Buen día${dest.nombre ? ", " + String(dest.nombre).split(" ")[0].charAt(0) + String(dest.nombre).split(" ")[0].slice(1).toLowerCase() : ""}. Le toca la revisión de la semana que cerró.\n\n`;

    if (pend.length) {
      msg += `*PENDIENTE DE EXPLICAR* — pídalo ahora que está fresco:\n\n` + pend.join("\n\n") + `\n\n`;
    } else {
      msg += `✅ *Esta semana no quedó nada pendiente de explicar*: todos los movimientos del banco tienen categoría, no hay cuentas por pagar sin soporte y no hay fallas de unidad abiertas.\n\n`;
    }

    msg += `*LO QUE SE MOVIÓ ESTA SEMANA*\n` +
      `⛽ ${surt.length} surtida(s) · ${n(Math.round(litros))} litros\n` +
      `🏛️ ${abo.length} cobro(s) registrado(s)\n` +
      `📥 ${cxpSem.length} cuenta(s) por pagar nueva(s)\n\n` +
      `*Para revisarlo todo junto:* entre a 🔍 *Auditoría* → 📁 *Carpeta del Auditor*, ponga ` +
      `${dmy(desde)} a ${dmy(hasta)} y le arma en un solo documento el mantenimiento por unidad, ` +
      `el combustible, los cobros, los movimientos del banco, las cuentas por pagar, la nómina, las ` +
      `retenciones y los accesos. Se imprime o se guarda en PDF.\n\n` +
      `Y en 📋 *Relación de gastos* puede filtrar ese mismo período por tipo de gasto e imprimirlo.\n\n` +
      `Mientras más fresco lo pida, más fácil es que administración se lo consiga.`;

    if (!dry) {
      await enqueue([{
        telefono: String(dest.tel).replace(/[\s\-\+]/g, ""),
        mensaje: msg, tipo: "auditora_semanal", estado: "pendiente", ref: key,
      }]);
    }

    return new Response(JSON.stringify({
      ok: true, dry, key, semana: { desde, hasta },
      destinataria: { nombre: dest.nombre, tel: dest.tel, de: dest.motivo },
      pendientes: {
        movimientos_sin_clasificar: movsPend.length, de_esta_semana: movSemana, mas_viejo: movViejo,
        cxp_sin_soporte: cxpSinSop.length, planillas_sin_ayudante: plSinAy,
        fallas_abiertas: anomAb.length, ordenes_sin_cerrar: osAbiertas.length,
      },
      semana_movio: { surtidas: surt.length, litros: Math.round(litros), cobros: abo.length, cxp_nuevas: cxpSem.length },
      preview: msg,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auditora-semanal error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
