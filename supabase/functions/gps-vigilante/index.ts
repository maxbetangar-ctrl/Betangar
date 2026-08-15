import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ══════════════════════════════════════════════════════════════════════════════
//  gps-vigilante — avisa cuando el rastreo se calla.
//
//  POR QUÉ EXISTE: un conector caído se ve EXACTAMENTE IGUAL que una flota quieta.
//  No entran filas, y no entrar filas no genera ningún error. Sin esta pieza, el
//  GPS puede dejar de guardar el lunes y nadie enterarse hasta que alguien vaya a
//  buscar el recorrido de la semana y no esté. Y lo que no se guardó no se
//  recupera: el proveedor NO tiene endpoint de historial (probados 31 nombres el
//  14/08/2026), así que el hueco es para siempre.
//
//  VIGILA TRES COSAS DISTINTAS, y son distintas a propósito:
//   1. 🔴 EL CONECTOR NO CORRE — `gps-sondeo` debería pasar cada 2 minutos. Si hace
//      más de 30 no pasa, no se está guardando NADA de NINGUNA unidad. Es lo más
//      grave y no tiene falsos positivos.
//   2. 🟡 UN EQUIPO SE CALLÓ — la unidad está activa pero su último reporte es
//      viejo. Puede ser el equipo desconectado, sin señal, o el camión sin trabajar.
//   3. 🟡 EL PROVEEDOR RECHAZA — quedó un error guardado en `gps_sync_estado`
//      (clave cambiada, placa dada de baja, API caída).
//
//  ⚠️ QUE NO SE VUELVA UN AVISO QUE SALTA SIEMPRE. Un aviso diario que repite lo
//  mismo se deja de leer, y entonces no avisa de nada. La clave de idempotencia NO
//  lleva la fecha de hoy: lleva **el momento desde el cual la unidad está callada**.
//  Así se avisa UNA VEZ POR EPISODIO: mientras siga muda desde el mismo instante no
//  vuelve a sonar, y si se recupera y se calla de nuevo, eso sí es un episodio nuevo.
//  Un camión parado dos semanas en el taller avisa una vez, no catorce.
//
//  UN SOLO MENSAJE con todo lo que pase, no uno por unidad.
//  `?dry=1` = calcula y devuelve, sin encolar ni marcar nada.
// ══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const AVISAR_A = Deno.env.get("GPS_AVISAR_A") || "584149614915";  // Máximo
const MIN_CONECTOR = 30;   // minutos sin correr el sondeo = está caído
const HS_MUDO = 5;         // horas sin reportar de una unidad activa

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function encolar(rows: any[]) {
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

// La hora que se le muestra a una persona es la del NEGOCIO: Venezuela, UTC-4.
function horaVE(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(new Date(iso).getTime() - 4 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function hace(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

Deno.serve(async (req) => {
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const ahora = Date.now();

    const equipos = await sel("gps_equipos?select=cam,placa&activo=is.true&order=cam");
    if (!equipos.length) {
      return new Response(JSON.stringify({ ok: true, aviso: "no hay unidades activas" }), {
        headers: { "Content-Type": "application/json" } });
    }
    const estados = await sel("gps_sync_estado?select=cam,bajado_hasta,ultima_corrida,ultimo_ok,ultimo_error");
    const porCam: Record<string, any> = {};
    estados.forEach((e) => { porCam[e.cam] = e; });

    const lineas: string[] = [];
    const claves: string[] = [];

    // ── 1. ¿Está corriendo el conector? ──────────────────────────────────────
    // Se mira la corrida MÁS RECIENTE de todas: alcanza con que una unidad haya
    // sido consultada para saber que el sondeo pasó.
    const corridas = estados.map((e) => e.ultima_corrida).filter(Boolean)
      .map((t: string) => new Date(t).getTime());
    const ultimaCorrida = corridas.length ? Math.max(...corridas) : 0;
    const minSinCorrer = ultimaCorrida ? (ahora - ultimaCorrida) / 60000 : 99999;

    if (minSinCorrer > MIN_CONECTOR) {
      // La clave lleva el momento de la última corrida: mientras siga caído desde
      // el mismo instante, no vuelve a avisar.
      const k = `gps-conector-caido-${ultimaCorrida || "nunca"}`;
      claves.push(k);
      if (!(await yaAviso(k))) {
        lineas.push(
          `🔴 *El rastreo NO se está guardando.*\n` +
          `La última consulta al GPS fue ${ultimaCorrida ? horaVE(new Date(ultimaCorrida).toISOString()) + " (" + hace(ahora - ultimaCorrida) + ")" : "nunca"}, ` +
          `y debería pasar cada 2 minutos.\n` +
          `⚠️ Todo lo que no se guarde ahora NO se recupera después: el proveedor no ` +
          `guarda historial que podamos bajar.`
        );
      } else { claves.pop(); }
    }

    // ── 2. ¿Qué unidades se callaron? ────────────────────────────────────────
    const mudas: string[] = [];
    for (const eq of equipos) {
      const st = porCam[eq.cam];
      const ult = st?.bajado_hasta ? new Date(st.bajado_hasta).getTime() : 0;
      const hs = ult ? (ahora - ult) / 3600000 : 99999;
      if (hs <= HS_MUDO) continue;

      // Clave por EPISODIO (el momento desde el que está muda), no por día.
      const k = `gps-mudo-${eq.cam}-${ult || "nunca"}`;
      if (await yaAviso(k)) continue;
      claves.push(k);
      mudas.push(
        ult ? `• ${eq.cam} — último reporte ${horaVE(st.bajado_hasta)} (${hace(ahora - ult)})`
            : `• ${eq.cam} — nunca ha reportado`
      );
    }
    if (mudas.length) {
      lineas.push(
        `🟡 *${mudas.length} unidad${mudas.length > 1 ? "es" : ""} sin reportar* hace más de ${HS_MUDO} horas:\n` +
        mudas.join("\n") +
        `\nPuede ser el equipo desconectado, sin señal, o el camión sin trabajar.`
      );
    }

    // ── 3. ¿El proveedor está rechazando? ────────────────────────────────────
    const conError = estados.filter((e) => e.ultimo_error);
    const errs: string[] = [];
    for (const e of conError) {
      const k = `gps-error-${e.cam}-${String(e.ultimo_error).slice(0, 40)}`;
      if (await yaAviso(k)) continue;
      claves.push(k);
      errs.push(`• ${e.cam}: ${String(e.ultimo_error).slice(0, 90)}`);
    }
    if (errs.length) {
      lineas.push(`🟡 *El proveedor de GPS está devolviendo error:*\n` + errs.join("\n"));
    }

    if (!lineas.length) {
      return new Response(JSON.stringify({
        ok: true, sin_novedad: true, unidades: equipos.length,
        min_sin_correr: Math.round(minSinCorrer),
      }), { headers: { "Content-Type": "application/json" } });
    }

    const msg = `🛰️ *Rastreo GPS*\n\n` + lineas.join("\n\n");

    if (!dry) {
      await encolar([{ tipo: "gps_vigilante", telefono: AVISAR_A, mensaje: msg, ref: "gps-vigilante" }]);
      for (const k of claves) await marcar(k);
    }

    return new Response(JSON.stringify({
      ok: true, dry, avisos: lineas.length, claves, mensaje: msg,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    // El error se devuelve, no se traga: un vigilante que falla en silencio es
    // peor que no tener vigilante, porque encima da tranquilidad.
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { "Content-Type": "application/json" } });
  }
});
