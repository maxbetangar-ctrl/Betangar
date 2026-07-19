import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — Supervisor de KILOMETRAJE. Corre diario: revisa los checklists del día y, si el km que
// metió el chofer NO tiene coherencia (retrocede, o salta muchísimo más de lo que ese camión hace por
// día), le escribe por WhatsApp al chofer — para que sepa que se le supervisa. Encola en cola_mensajes
// (el worker antepone "♻️ Betangar:"). Idempotente por unidad+fecha (alertas_log). ?dry=1 = no envía.
// La flota hace ~60-130 km/día → un salto >400/día o un retroceso = casi seguro un tipeo.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const RATE_MAX = 400;   // km/día por encima del cual es sospechoso (flota real ~60-130)
const BAJA_MIN = 30;    // tolerancia de "baja" (redondeos); por debajo de -30 es retroceso real
const SUP_FALLBACK = "584146001635"; // Samuel (operativo) si no se ubica el teléfono del chofer

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
function veHoy(): string { return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); }
const norm = (s: string) => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z\s]/g, " ").trim();
const kmMax = (r: any) => Math.max(Number(r.km_salida) || 0, Number(r.km_entrada) || 0);

// Ubica el teléfono del chofer: match por nombre (comparte >=2 palabras) contra empleados con whatsapp.
function telChofer(conductor: string, emps: any[]): string {
  const t = norm(conductor).split(/\s+/).filter((w) => w.length > 2);
  if (!t.length) return "";
  let best = "", bestN = 0;
  for (const e of emps) {
    if (!e.whatsapp) continue;
    const et = norm(e.nombre).split(/\s+/).filter((w) => w.length > 2);
    const inter = t.filter((w) => et.includes(w)).length;
    if (inter > bestN) { bestN = inter; best = String(e.whatsapp); }
  }
  return bestN >= 2 ? best : "";
}

Deno.serve(async (req) => {
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const hoy = veHoy();
    const desde = new Date(Date.now() - 17 * 86400000).toISOString().slice(0, 10); // ventana para tener el "anterior"
    const limite = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10); // solo avisar los de <=2 días

    const ck = await sel(`checklist?fecha=gte.${desde}&select=cam,fecha,km_salida,km_entrada,conductor&order=cam.asc,fecha.asc`);
    const emps = await sel(`empleados?select=nombre,cargo,whatsapp&activo=eq.true`);

    // Agrupar por cam y recorrer en orden de fecha comparando contra el km anterior válido.
    const porCam: Record<string, any[]> = {};
    for (const r of ck) { const c = String(r.cam || ""); if (!c) continue; (porCam[c] ||= []).push(r); }

    const avisos: any[] = [];
    for (const cam of Object.keys(porCam)) {
      const arr = porCam[cam];
      let prevKm = 0, prevF = "";
      for (const r of arr) {
        const km = kmMax(r); if (km <= 0) continue;
        const f = String(r.fecha || "").slice(0, 10);
        if (prevKm > 0 && f > prevF) {
          const dias = Math.max(1, Math.round((new Date(f + "T12:00:00Z").getTime() - new Date(prevF + "T12:00:00Z").getTime()) / 86400000));
          const delta = km - prevKm;
          const rate = delta / dias;
          const retro = delta < -BAJA_MIN;
          const salto = rate > RATE_MAX;
          if ((retro || salto) && f >= limite) {
            const key = `km_anom_${cam}_${f}`;
            if (dry || !(await yaAviso(key))) {
              const tel = telChofer(r.conductor || "", emps) || SUP_FALLBACK;
              const nom = String(r.conductor || "").split(/\s+/)[0] || "";
              const msg = `⚠️ *Supervisión de kilometraje — ${cam}*\n\n` +
                `Hola ${nom}, el km que registraste (${km.toLocaleString("es-VE")}) no tiene coherencia con el anterior (${prevKm.toLocaleString("es-VE")}) — ${retro ? "no puede ser MENOR" : "es un salto demasiado grande para un día"}. Parece un error de tipeo.\n\n` +
                `📌 *ES UNA ORDEN:* pon SIEMPRE el kilómetro REAL que marca el tablero, sin dígitos de más ni de menos. Estamos supervisando esto de cerca porque afecta el mantenimiento del camión.\n\n` +
                `👉 Por favor respóndeme aquí *si lo leíste: Sí o No.* 🙏`;
              avisos.push({ telefono: String(tel).replace(/[\s\-\+]/g, ""), mensaje: msg, tipo: "supervision", estado: "pendiente", _key: key, _cam: cam, _f: f });
            }
          }
        }
        if (km > prevKm) { prevKm = km; prevF = f; } // el odómetro solo sube; ignora los retrocesos como referencia
        else if (prevKm === 0) { prevKm = km; prevF = f; }
      }
    }

    if (dry) return json({ ok: true, dry: true, hoy, detectados: avisos.map((a) => ({ cam: a._cam, fecha: a._f, tel: a.telefono })) });

    if (avisos.length) {
      await enqueue(avisos.map((a) => ({ telefono: a.telefono, mensaje: a.mensaje, tipo: a.tipo, estado: a.estado })));
      for (const a of avisos) await marcar(a._key);
    }
    return json({ ok: true, hoy, avisados: avisos.length, unidades: avisos.map((a) => a._cam) });
  } catch (e) {
    console.error("km-anomalias", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});

function json(b: unknown) { return new Response(JSON.stringify(b, null, 2), { headers: { "Content-Type": "application/json" } }); }
