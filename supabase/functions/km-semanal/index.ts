import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — KILÓMETROS DE LA SEMANA (lunes, 7:00 am VE).
//
// POR QUÉ EXISTE ESTA FUNCIÓN (2026-07-20). El reporte lo armaba `guardarKmLunes()` en app.js,
// o sea EN EL NAVEGADOR de quien abriera la app un lunes. Dos defectos que se veían juntos:
//   1) Se enviaba UNA VEZ POR CADA PERSONA/NAVEGADOR que abría la app, porque el candado era
//      localStorage (vive en el dispositivo, no impide que otro lo mande). El 2026-07-20 salió
//      3 veces. Aquí el candado es `alertas_log.alert_key` (UNIQUE) = compartido por todos.
//   2) Daba "0 km" en los 12 camiones porque restaba `km_data.km_lunes` menos `km_data.km`, y
//      la columna `km_lunes` NUNCA EXISTIÓ en la tabla: el read daba undefined (caía al propio
//      km → X menos X = 0) y el write que debía guardarla fallaba en silencio.
// Ahora los km salen de donde REALMENTE están: el checklist que llena el chofer cada día
// (km_salida / km_entrada), que es el mismo dato con el que se calcula el km del día.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Un camión no puede rodar más de esto en un día (mismo tope que el candado del chofer).
// Protege el total contra un odómetro mal tipeado.
const KM_MAX_DIA = 1500;

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
function dmy(s: string): string { const p = s.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; }

// Candado COMPARTIDO: el UNIQUE de alert_key hace que solo UNA corrida gane, aunque el cron
// se dispare dos veces o alguien invoque la función a mano.
async function tomarCandado(key: string, dry: boolean): Promise<boolean> {
  const rows = await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`);
  if (rows.length) return false;
  if (dry) return true;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
  return r.ok; // si otro lo insertó primero → 409 → false → no se manda dos veces
}

Deno.serve(async (_req: Request) => {
  try {
    const url = new URL(_req.url);
    const dry = url.searchParams.get("dry") === "1";
    // ?lunes=YYYY-MM-DD permite reenviar una semana puntual (o probar) sin esperar al lunes.
    const lunesParam = url.searchParams.get("lunes");

    const hoy = veNow();
    // Semana reportada = lunes a sábado ANTERIORES al lunes en que corre.
    const lunesEstaSem = new Date(hoy);
    const dow = lunesEstaSem.getUTCDay();               // 0=dom, 1=lun
    lunesEstaSem.setUTCDate(lunesEstaSem.getUTCDate() - ((dow + 6) % 7));
    const ini = new Date(lunesEstaSem); ini.setUTCDate(ini.getUTCDate() - 7);
    const fin = new Date(ini); fin.setUTCDate(fin.getUTCDate() + 5);   // sábado
    const desde = lunesParam || ymd(ini);
    const hasta = lunesParam ? ymd(new Date(new Date(lunesParam + "T12:00:00Z").getTime() + 5 * 86400000)) : ymd(fin);

    const key = `km_semanal_${desde}`;
    if (!(await tomarCandado(key, dry))) {
      return new Response(JSON.stringify({ ok: true, skip: "ya enviado", key }), { headers: { "Content-Type": "application/json" } });
    }

    // Config de destinatarios por rol
    const cfg = await sel(`configuracion?clave=eq.whatsapp&select=valor`);
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = []; }

    // NORMA: al nombrar una unidad, mostrar también la placa.
    const ucfg = await sel(`unidad_config?select=cam,placa`);
    const PLACA: Record<string, string> = {};
    for (const u of ucfg) { if (u.cam && u.placa) PLACA[String(u.cam)] = String(u.placa); }
    const Us = (cam: string) => { const s = String(cam).replace("JAC-", ""); return PLACA[cam] ? `${s} (${PLACA[cam]})` : s; };

    // Flota considerada = la que existe en km_data (excluye vehículos de servicio SRV).
    const kmRows = await sel(`km_data?select=cam,km,estado`);
    const fleet = kmRows.map((k: any) => String(k.cam || "")).filter((c: string) => c.startsWith("JAC-B")).sort();
    const estadoCam: Record<string, string> = {};
    for (const k of kmRows) estadoCam[String(k.cam)] = String(k.estado || "operativo");

    // ── EL DATO REAL: el checklist diario del chofer ──
    const ck = await sel(`checklist?fecha=gte.${desde}&fecha=lte.${hasta}&select=cam,fecha,km_salida,km_entrada,chofer_km_salida,chofer_km_entrada`);
    type Acc = { km: number; dias: number; sinCierre: number; primero: number; ultimo: number };
    const acc: Record<string, Acc> = {};
    for (const r of ck) {
      const cam = String(r.cam || ""); if (!cam) continue;
      const sal = Number(r.km_salida ?? r.chofer_km_salida ?? 0);
      const ent = Number(r.km_entrada ?? r.chofer_km_entrada ?? 0);
      const a = acc[cam] || (acc[cam] = { km: 0, dias: 0, sinCierre: 0, primero: 0, ultimo: 0 });
      if (sal > 0) { a.primero = a.primero ? Math.min(a.primero, sal) : sal; a.ultimo = Math.max(a.ultimo, sal); }
      if (ent > 0) a.ultimo = Math.max(a.ultimo, ent);
      if (sal > 0 && ent > 0 && ent >= sal) {
        const d = ent - sal;
        if (d <= KM_MAX_DIA) { a.km += d; a.dias++; }           // día bueno
        else a.sinCierre++;                                     // salto imposible → no se suma
      } else if (sal > 0 && ent <= 0) {
        a.sinCierre++;                                          // salió y nunca cerró el día
      }
    }

    const lineas: string[] = [];
    let total = 0, sinDato = 0, diasSinCierre = 0;
    for (const cam of fleet) {
      const a = acc[cam];
      if (!a || (!a.dias && !a.sinCierre)) {
        const est = estadoCam[cam];
        lineas.push(`• ${Us(cam)}: sin checklist${est && est !== "operativo" ? ` (${est})` : ""}`);
        sinDato++;
        continue;
      }
      total += a.km;
      diasSinCierre += a.sinCierre;
      lineas.push(`• ${Us(cam)}: ${a.km.toLocaleString("es-VE")} km · ${a.dias} día(s)` +
        (a.sinCierre ? ` · ⚠️ ${a.sinCierre} sin cerrar` : ""));
    }

    const activas = fleet.length - sinDato;
    let msg = `🚛 KILÓMETROS DE LA SEMANA\n${dmy(desde)} al ${dmy(hasta)}\n\n${lineas.join("\n")}\n\n` +
      `TOTAL FLOTA: ${total.toLocaleString("es-VE")} km` +
      (activas > 0 ? `\nPromedio por unidad: ${Math.round(total / activas).toLocaleString("es-VE")} km` : "");
    if (diasSinCierre) msg += `\n\n⚠️ ${diasSinCierre} día(s) sin km de entrada: el chofer salió y no cerró el checklist, esos km no se cuentan.`;
    if (sinDato) msg += `\n⚠️ ${sinDato} unidad(es) sin ningún checklist en la semana.`;

    // Mismos destinatarios que antes: socios + jefe operativo. Es km, no dinero.
    const dest = wa.filter((w: any) => w.num && w.activo && (w.rol === "socios" || w.rol === "operativo"));
    const vistos = new Set<string>();
    const uniq = dest.filter((w: any) => { const n = String(w.num).replace(/[\s\-\+]/g, ""); if (!n || vistos.has(n)) return false; vistos.add(n); return true; });
    if (!dry) {
      await enqueue(uniq.map((w: any) => ({ telefono: String(w.num).replace(/[\s\-\+]/g, ""), mensaje: msg, tipo: "km_semanal", estado: "pendiente", ref: key })));
    }

    return new Response(JSON.stringify({
      ok: true, dry, key, semana: { desde, hasta }, total, activas, sinDato, diasSinCierre,
      destinatarios: uniq.map((d: any) => d.desc || d.rol), preview: msg,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("km-semanal error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
