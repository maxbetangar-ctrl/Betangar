import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — Supervisor de NÓMINA. Corre semanal (lunes): si la última nómina guardada quedó atrás
// respecto a las planillas (semanas cerradas sin guardar), avisa a Máximo + admin, porque mientras no
// se guarde la nómina la UTILIDAD REAL está inflada (no descuenta esos sueldos). Encola en cola_mensajes.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function enqueue(rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
}
const ddmm = (s: string) => { const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };

Deno.serve(async (req) => {
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    // Última nómina guardada (fecha_hasta) y última planilla.
    const nom = await sel(`nomina_historial?select=fecha_hasta&fecha_hasta=not.is.null&order=fecha_hasta.desc&limit=1`);
    const plan = await sel(`planillas?select=f&order=f.desc&limit=1`);
    const lastNom = String(nom[0]?.fecha_hasta || "").slice(0, 10);
    const lastPlan = String(plan[0]?.f || "").slice(0, 10);
    if (!lastPlan) return json({ ok: true, msg: "sin planillas" });

    // ¿Cuántos días/semanas hay de planillas SIN nómina guardada? (semana cerrada = 7+ días atrás)
    const desde = lastNom || "2000-01-01";
    const diasAtraso = lastNom ? Math.round((new Date(lastPlan + "T12:00:00Z").getTime() - new Date(lastNom + "T12:00:00Z").getTime()) / 86400000) : 999;
    // Solo avisar si hay al menos una semana cerrada sin guardar (7+ días de brecha).
    if (diasAtraso < 7) return json({ ok: true, al_dia: true, lastNom, lastPlan, diasAtraso });

    const semanas = Math.max(1, Math.floor(diasAtraso / 7));
    // Impacto: planillas facturadas en el período sin nómina (proxy del tamaño del hueco).
    const pf = await sel(`planillas?f=gt.${desde}&f=lte.${lastPlan}&select=m,t`);
    const facturado = pf.reduce((a: number, p: any) => a + (parseFloat(p.m) || 0), 0);
    const viajes = pf.reduce((a: number, p: any) => a + (parseInt(p.t) || 0), 0);

    // Destinatarios = socios + admin (fuente única: configuracion.whatsapp).
    const cfg = await sel(`configuracion?clave=eq.whatsapp&select=valor`);
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = []; }
    const nums = Array.from(new Set((Array.isArray(wa) ? wa : [])
      .filter((w: any) => w.num && w.activo && (w.rol === "socios" || w.rol === "admin"))
      .map((w: any) => String(w.num).replace(/[\s\-\+]/g, ""))));
    if (!nums.length) nums.push("584147379886"); // fallback Máximo

    const msg = `💰 *Supervisión de nómina*\n\n` +
      `Hay *${semanas} semana(s) de nómina SIN guardar* (la última guardada llega al ${lastNom ? ddmm(lastNom) : "—"}, y ya hay planillas hasta el ${ddmm(lastPlan)}).\n\n` +
      `⚠️ Mientras no se guarden, la *Utilidad Real está inflada*: cuenta lo cobrado pero NO descuenta esos sueldos. En ese período van *${viajes.toLocaleString("es-VE")} viajes* facturados (Bs ${facturado.toLocaleString("es-VE", { maximumFractionDigits: 0 })}).\n\n` +
      `👉 *Guarda las semanas pendientes* en el módulo Nómina para que los números sean reales.`;

    if (dry) return json({ ok: true, dry: true, semanas, lastNom, lastPlan, viajes, facturado, destinos: nums });
    await enqueue(nums.map((n) => ({ telefono: n, mensaje: msg, tipo: "supervision", estado: "pendiente" })));
    return json({ ok: true, semanas, avisados: nums.length });
  } catch (e) {
    console.error("supervisor-nomina", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});

function json(b: unknown) { return new Response(JSON.stringify(b, null, 2), { headers: { "Content-Type": "application/json" } }); }
