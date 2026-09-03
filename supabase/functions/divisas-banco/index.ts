// ════════════════════════════════════════════════════════════════════════════════════════════
// DIVISAS-BANCO — avisar cuando el banco compra dólares por su cuenta
//
// 🔬 POR QUÉ EXISTE. Máximo, 02/09/2026: «el banco toma bolívares que hayan en la cuenta, y lo
//    cambian a dólares y entran en una cuenta en dólares que tiene Betangar, pero como lo hacen
//    SIN AVISAR me gustaría que sepas registrarlo, y me avises que el banco debitó tanto para la
//    compra de tantos dólares». Cobran además un 0,5%.
//
//    Es plata que se mueve sola: nadie la ordenó, nadie firmó nada, y el único rastro es el
//    estado de cuenta. Hasta el 02/09 el sistema la bajaba y no la entendía — el cargo se
//    contaba como GASTO y el abono en dólares como si fueran bolívares.
//
// 📌 LOS DÓLARES NO SE CALCULAN, LOS DICE EL BANCO. El estado de cuenta trae la pata del abono
//    con el monto exacto en divisas. Dividir el cargo por el BCV del día daría otro número: el
//    24/08 el banco liquidó a la tasa del 23/08 y el cálculo habría dado 2.498,71 en vez de
//    2.500. Acá la tasa se DEDUCE de la operación (cargo ÷ abono) y se muestra al lado del BCV
//    de ese día, que es lo que permite ver si el banco cobró de más.
//    Si faltara la pata del abono NO se estima: se avisa que falta.
//
// ⛔ NO manda nada fuera de la franja 8:00–20:00 hora de Venezuela, y cuando está fuera tampoco
//    marca el aviso como dado: queda para la corrida siguiente. [[norma-hora-del-destinatario-antes-de-enviar]]
//
// Destinatarios: los MISMOS del aviso de cobro de la Alcaldía — `configuracion.whatsapp`, roles
// `socios` y `admin`. Máximo lo pidió así: «le envías mensajes a la misma gente de cuando nos
// paga la alcaldía». Fuente única: si mañana entra o sale un socio, se cambia en un solo sitio.
//
// Uso:  POST /divisas-banco            → clasifica, mide la tasa y avisa lo fresco (≤7 días)
//       POST /divisas-banco?dry=1      → dice qué avisaría, sin mandar ni marcar nada
//       POST /divisas-banco?todo=1     → avisa también las viejas (para la primera corrida)
// ════════════════════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Cuántos días hacia atrás se considera «fresco». Corriendo dos veces al día lo normal es 0-1
// operaciones; 7 días aguanta una semana caído sin disparar una avalancha de avisos viejos.
const DIAS_FRESCO = 7;
// La franja en que se le puede escribir a una persona. La hora es la del NEGOCIO, Venezuela.
const HORA_DESDE = 8;
const HORA_HASTA = 20;

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// ⛔ EL MISMO CANDADO QUE `bnc-traer`. Esta función se despliega sin verificación de JWT (así la
// llama el cron), y su respuesta trae montos del banco y números de cuenta: sin esto, cualquiera
// con la URL los lee. Fail-closed — sin el secreto configurado NO se abre — y la comparación es
// en tiempo constante para no filtrar el largo. [[norma-seguridad-dos-niveles]]
const FN_SECRET = Deno.env.get("BTG_FN_SECRET") || "";
function autorizado(req: Request): boolean {
  if (!FN_SECRET) return false;
  const k = req.headers.get("x-api-key") || "";
  if (k.length !== FN_SECRET.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ FN_SECRET.charCodeAt(i);
  return d === 0;
}

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function rpc(fn: string): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: "{}",
  });
  if (!r.ok) { console.error("rpc", fn, r.status, await r.text()); return null; }
  return await r.json();
}
async function enqueue(rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
}
async function yaAviso(key: string): Promise<boolean> {
  const r = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  return r.length > 0;
}
async function marcar(key: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
}

// Venezuela es UTC-4 todo el año (no mueve el reloj), así que el desplazamiento es fijo.
const ahoraVE = () => new Date(Date.now() - 4 * 3600 * 1000);
const veHoy = () => ahoraVE().toISOString().slice(0, 10);
const horaVE = () => ahoraVE().getUTCHours();
const ddmm = (s: string) => { const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
const num = (n: unknown, d = 2) =>
  Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: d, maximumFractionDigits: d });
// Los últimos 4 dígitos alcanzan para que se sepa de cuál cuenta salió sin escribir el número entero.
const cuentaCorta = (c: unknown) => { const s = String(c || ""); return s ? "…" + s.slice(-4) : "(no dice)"; };
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

Deno.serve(async (req) => {
  if (!autorizado(req)) {
    return json({ error: "No autorizado" }, 401);
  }
  try {
    const u = new URL(req.url);
    const dry = u.searchParams.get("dry") === "1";
    const todo = u.searchParams.get("todo") === "1";
    const hoy = veHoy();

    // 1) Reconocer y medir. Las dos corren siempre: es lo que convierte tres líneas sueltas del
    //    banco en una operación entendible, y no depende de que haya algo que avisar.
    const clasificados = await rpc("bnc_clasificar");
    const tasas = await rpc("btg_atar_intervencion_cambiaria");

    // 2) Las operaciones, ya armadas
    const ops = await sel("v_intervencion_cambiaria?order=fecha.desc");

    // 3) Destinatarios. Salen de `configuracion.whatsapp`, igual que el aviso de la Alcaldía:
    //    fuente única, así que si mañana entra o sale alguien se cambia en UN solo sitio.
    //
    //    Máximo (02/09/2026) pidió para ESTE aviso una lista más larga que la de la Alcaldía:
    //    «a mí, a Fran, a Jonaz y a Keily la administradora», y después «sí, Alejandro también».
    //    Eso es exactamente `socios` (Máximo y Fran) + `banco` (Jonaz y Alejandro) + `admin`.
    //
    // 📌 `admin` va en la lista aunque HOY esté vacante (Auredy Medina, baja el 06/08/2026):
    //    ⏳ Keily, la administradora, todavía no está cargada. El día que se le dé de alta con
    //    rol `admin` empieza a recibir estos avisos SOLA, sin tocar ni desplegar nada. La fila
    //    vacante no molesta: no tiene número y está inactiva, y el filtro exige las dos cosas.
    const ROLES_QUE_AVISAN = ["socios", "admin", "banco"];
    const cfg = await sel("configuracion?clave=eq.whatsapp&select=valor");
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = []; }
    const nums = Array.from(new Set((Array.isArray(wa) ? wa : [])
      .filter((w: any) => w.num && w.activo && ROLES_QUE_AVISAN.includes(w.rol))
      .map((w: any) => String(w.num).replace(/[\s\-+]/g, ""))));
    if (!nums.length) nums.push("584147379886"); // fallback Máximo

    // 4) Fuera de la franja no se escribe, y tampoco se marca: queda para la corrida siguiente.
    //    ⚠️ Marcar acá sería peor que no avisar — el aviso se perdería en silencio.
    const h = horaVE();
    const enFranja = h >= HORA_DESDE && h < HORA_HASTA;

    const avisos: string[] = [];
    // Los que están listos pero fuera de hora. En `dry` van con su texto: si no, probar de noche
    // no deja ver el mensaje que se va a mandar, que es justo lo que se quiere revisar antes.
    const pendientes: any[] = [];
    for (const o of ops) {
      const key = `divisa_banco_${o.ref_banco}_${String(o.fecha).slice(0, 10)}`;
      if (await yaAviso(key)) continue;

      const viejo = diasEntre(String(o.fecha).slice(0, 10), hoy) > DIAS_FRESCO;
      if (viejo && !todo) { if (!dry) await marcar(key); continue; }

      let msg: string;
      if (o.falta_el_abono) {
        // El cargo está y el abono no. Puede ser que el estado de cuenta de la cuenta en divisas
        // todavía no haya bajado. No se inventa el monto: se dice que falta.
        msg = `🏦 *El banco tomó bolívares para comprar dólares*\n\n` +
          `📅 ${ddmm(o.fecha)}  ·  🔖 Ref: ${o.ref_banco}\n` +
          `💸 Debitó: *Bs ${num(o.bs_debitado)}* de la cuenta ${cuentaCorta(o.cuenta_origen)}\n` +
          (o.bs_comision ? `🧾 Comisión: *Bs ${num(o.bs_comision)}*\n` : "") +
          `\n⚠️ Todavía no se ve en cuánto quedaron los dólares: falta el abono en la cuenta en ` +
          `divisas. En cuanto el banco lo refleje sale el monto exacto.\n` +
          `👉 Mientras tanto esa compra no se puede valuar.`;
      } else {
        const bcv = Number(o.bcv_del_dia) || 0;
        const tasa = Number(o.tasa_operacion) || 0;
        // Comparar la tasa de la operación contra el BCV del día es lo único que permite ver si
        // el banco cobró de más. No se acusa: se muestran las dos y se dice la diferencia.
        const dif = bcv > 0 ? ((tasa - bcv) / bcv) * 100 : 0;
        const lineaBcv = bcv > 0
          ? (Math.abs(dif) < 0.05
              ? `📊 Tasa de la operación: *${num(tasa, 4)}* Bs/$ — el BCV de ese día\n`
              : `📊 Tasa de la operación: *${num(tasa, 4)}* Bs/$\n` +
                `     BCV del ${ddmm(o.fecha)}: ${num(bcv, 4)} · ${dif > 0 ? "arriba" : "abajo"} ${num(Math.abs(dif), 2)}%\n`)
          : `📊 Tasa de la operación: *${num(tasa, 4)}* Bs/$\n`;
        const costoUsd = tasa > 0 ? Number(o.bs_comision || 0) / tasa : 0;
        msg = `🏦 *El banco compró dólares*\n\n` +
          `📅 ${ddmm(o.fecha)}  ·  🔖 Ref: ${o.ref_banco}\n` +
          `💸 Debitó: *Bs ${num(o.bs_debitado)}* de la cuenta ${cuentaCorta(o.cuenta_origen)}\n` +
          (o.bs_comision
            ? `🧾 Comisión (${num(o.comision_pct, 2)}%): *Bs ${num(o.bs_comision)}* ≈ US$ ${num(costoUsd)}\n`
            : "") +
          `💵 Entraron: *US$ ${num(o.usd_recibidos)}* a la cuenta ${cuentaCorta(o.cuenta_destino)}\n` +
          lineaBcv +
          `\nQuedó registrado como compra de dólares, no como gasto: es la misma plata en otra moneda.`;
      }

      if (!enFranja) { pendientes.push(dry ? { key, mensaje: msg } : key); continue; }
      avisos.push(msg);
      if (!dry) await marcar(key);
    }

    if (dry) {
      return json({
        ok: true, dry: true, hora_ve: h, en_franja: enFranja,
        clasificados, tasas_medidas: tasas, operaciones: ops.length,
        destinos: nums, avisos, pendientes_por_hora: pendientes,
      });
    }
    for (const msg of avisos) {
      await enqueue(nums.map((n) => ({ telefono: n, mensaje: msg, tipo: "divisas", estado: "pendiente" })));
    }
    return json({
      ok: true, hora_ve: h, en_franja: enFranja, clasificados, tasas_medidas: tasas,
      operaciones: ops.length, avisos: avisos.length, pendientes_por_hora: pendientes.length,
    });
  } catch (e) {
    console.error("divisas-banco", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
});
