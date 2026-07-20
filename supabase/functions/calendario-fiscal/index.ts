import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — RECORDATORIO DE DECLARACIONES AL SENIAT (cron diario 7:00 am VE).
//
// Calendario fiscal 2026 de INVERSIONES BETANGAR C.A. (RIF J-29566107-0, termina en 0),
// cargado en la tabla `calendario_fiscal` desde el PDF oficial del SENIAT.
//
// Manda DOS avisos por obligación, como los pidió Máximo:
//   · 3 días antes  → "Estás a 3 días de tu declaración"
//   · el mismo día  → "HOY es el día de declarar"
// Y además avisa lo VENCIDO sin declarar (eso no se pidió, pero una declaración que se pasó
// es multa: callarla sería peor que avisarla).
//
// Destinatarios: Administradora (Aurelys), Máximo y la Contadora (Ana Fuenmayor).
// Salen de `configuracion.whatsapp` por rol → se cambian sin tocar código.
//
// En las declaraciones de IVA se incluye CUÁNTA RETENCIÓN hay acumulada en ese período
// (suma de cxp_facturas), porque esa plata NO es de la empresa: se le debe al SENIAT.

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
function bs2(n: number): string { return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Candado compartido: el UNIQUE de alert_key evita que dos corridas manden lo mismo.
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

// Retenciones acumuladas del período. LA CIFRA OFICIAL ESTÁ EN BOLÍVARES (`seniat_retenciones`):
// al SENIAT se le deben Bs exactos, el $ no es la obligación. Se lee la tabla cerrada; si por lo
// que sea no hubiera fila, se cae a sumar las facturas del rango (mismo dato, calculado al vuelo).
async function retencionesDe(periodoKey: string, desde: string, hasta: string) {
  const r = await sel(`seniat_retenciones?periodo=eq.${encodeURIComponent(periodoKey)}&select=*`);
  if (r.length) {
    const x = r[0];
    return { iva: Number(x.ret_iva_bs || 0), islr: Number(x.ret_islr_bs || 0), n: Number(x.facturas || 0), estado: String(x.estado || "pendiente") };
  }
  const fs = await sel(`cxp_facturas?fecha=gte.${desde}&fecha=lte.${hasta}&select=ret_iva_bs,ret_islr_bs`);
  let iva = 0, islr = 0, n = 0;
  for (const f of fs) { iva += Number(f.ret_iva_bs || 0); islr += Number(f.ret_islr_bs || 0); n++; }
  return { iva, islr, n, estado: "pendiente" };
}

// Del texto del período ("1ra quincena julio 2026") saca el rango de fechas a sumar.
const MESES: Record<string, number> = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function rangoDePeriodo(periodo: string): { desde: string; hasta: string; key: string } | null {
  const p = periodo.toLowerCase();
  const mes = Object.keys(MESES).find((m) => p.includes(m));
  const anio = (p.match(/20\d\d/) || [])[0];
  if (!mes || !anio) return null;
  const mm = String(MESES[mes]).padStart(2, "0");
  const ultimo = new Date(Number(anio), MESES[mes], 0).getDate();
  if (p.includes("1ra quincena")) return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-15`, key: `${anio}-${mm}-Q1` };
  if (p.includes("2da quincena")) return { desde: `${anio}-${mm}-16`, hasta: `${anio}-${mm}-${ultimo}`, key: `${anio}-${mm}-Q2` };
  return { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${ultimo}`, key: `${anio}-${mm}` };
}

Deno.serve(async (_req: Request) => {
  try {
    const url = new URL(_req.url);
    const dry = url.searchParams.get("dry") === "1";
    const hoyStr = url.searchParams.get("hoy") || ymd(veNow());

    const cfg = await sel(`configuracion?clave=eq.whatsapp&select=valor`);
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = [] }
    // Solo quienes declaran: administradora, contadora y Máximo. NO va al resto de socios.
    const dest = wa.filter((w: any) => w.num && w.activo &&
      (w.rol === "admin" || w.rol === "contadora" || String(w.desc || "").toLowerCase().includes("maximo")));
    const vistos = new Set<string>();
    const uniq = dest.filter((w: any) => { const n = String(w.num).replace(/[\s\-\+]/g, ""); if (!n || vistos.has(n)) return false; vistos.add(n); return true; });

    const pend = await sel(`calendario_fiscal?declarado=is.false&select=*&order=fecha_declarar.asc`);
    const enviados: any[] = [];

    for (const o of pend) {
      const f = String(o.fecha_declarar).slice(0, 10);
      const dias = Math.round((new Date(f + "T12:00:00Z").getTime() - new Date(hoyStr + "T12:00:00Z").getTime()) / 86400000);
      let tipo = "", cab = "";
      if (dias === 3) { tipo = "3d"; cab = `⏰ Estás a 3 días de tu declaración`; }
      else if (dias === 0) { tipo = "hoy"; cab = `🚨 HOY es el día de declarar`; }
      else if (dias < 0) { tipo = "vencida"; cab = `❗ Declaración VENCIDA hace ${Math.abs(dias)} día(s)`; }
      else continue;

      // Lo vencido se recuerda una vez por semana, no todos los días (para que no se vuelva ruido).
      if (tipo === "vencida" && (Math.abs(dias) % 7 !== 0)) continue;

      const key = `fiscal_${o.id}_${tipo}_${hoyStr}`;
      if (!(await tomarCandado(key, dry))) continue;

      let extra = "";
      const rango = rangoDePeriodo(String(o.periodo || ""));
      if (rango && String(o.obligacion).startsWith("IVA")) {
        const r = await retencionesDe(rango.key, rango.desde, rango.hasta);
        if (r.n > 0) {
          // SIEMPRE en bolívares: es la cifra que se declara y se entera al SENIAT.
          extra = `\n\n💰 Retenciones a enterar del período (${r.n} factura(s)):` +
            `\n• IVA retenido: Bs ${bs2(r.iva)}` +
            (r.islr > 0 ? `\n• ISLR retenido: Bs ${bs2(r.islr)}` : "") +
            `\n• TOTAL: Bs ${bs2(r.iva + r.islr)}` +
            `\nEsa plata NO es de la empresa: se le debe al SENIAT.`;
        } else {
          extra = `\n\nℹ️ No hay facturas cargadas en el sistema para ese período.`;
        }
      }

      const msg = `${cab}\n\n📋 ${o.etiqueta}\n🗓️ Período: ${o.periodo}\n📅 Fecha límite: ${dmy(f)}` +
        (tipo === "hoy" ? `\n\n⚠️ Es HOY. Después de hoy corre multa.` : "") +
        (tipo === "vencida" ? `\n\n⚠️ Ya pasó la fecha. Si ya la declararon, márquenla como declarada en el sistema para que deje de avisar.` : "") +
        extra +
        `\n\nINVERSIONES BETANGAR C.A. · RIF J-29566107-0`;

      if (!dry) {
        await enqueue(uniq.map((w: any) => ({
          telefono: String(w.num).replace(/[\s\-\+]/g, ""), mensaje: msg,
          tipo: "fiscal", estado: "pendiente", ref: key,
        })));
      }
      enviados.push({ tipo, obligacion: o.etiqueta, periodo: o.periodo, fecha: f, preview: msg });
    }

    return new Response(JSON.stringify({
      ok: true, dry, hoy: hoyStr, pendientes: pend.length,
      destinatarios: uniq.map((d: any) => d.desc || d.rol), enviados,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("calendario-fiscal error", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
