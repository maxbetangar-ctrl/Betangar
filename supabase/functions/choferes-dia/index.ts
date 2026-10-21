import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ════════════════════════════════════════════════════════════════════════════
// BETANGAR — CHOFERES POR UNIDAD, todos los días a las 8:00 para el IMAU.
//
// POR QUÉ EXISTE
// El IMAU —el ente de la Alcaldía que tiene contratado el aseo— pidió saber a
// diario QUÉ CHOFER está manejando cada unidad y su teléfono: es a quien van a
// llamar ante una incidencia o una denuncia, para pedirle que pase por un sitio.
// Máximo autorizó mandar los teléfonos CON ESE FIN (21/10/2026).
//
// ⛔ CORRE EN LA NUBE, NO EN LA PC DE MÁXIMO. Máximo, 21/10/2026: «es importante
//    que ese reporte salga con mi computadora prendida o sin prenderla». El
//    primero salió a mano desde su máquina; esto lo dispara `pg_cron` contra
//    Supabase, así que su computadora no entra en la cadena.
//
// ⛔ LA FUENTE ES EL CHECKLIST, NO LA ASIGNACIÓN DE LA UNIDAD. El chofer revisa
//    su camión antes de encenderlo y ahí queda QUIÉN lo maneja y A QUÉ HORA. Por
//    eso un suplente aparece como suplente: medido el 21/10, desde el 12/09 hay
//    14 conductores distintos sobre 12 unidades en 24 combinaciones. Si leyera
//    el chofer asignado habría 12 y ninguna más.
//    El fichaje (`asistencia_dia`) es el RESPALDO: cubre menos —entre 2 y 5
//    unidades al día fichan solo con el ayudante— pero trae `empleado_id`, que
//    es un vínculo exacto. [[norma-la-vista-no-mide-lo-que-crees]]
//
// ⛔ UNA UNIDAD SIN CONFIRMAR SALE «SIN CONFIRMAR», nunca rellenada con el chofer
//    que tiene asignado: justo los días que hay un suplente, el asignado sería el
//    equivocado y el IMAU llamaría a quien no está manejando.
//    [[norma-falta-de-dato-no-es-un-dato]]
//
// ⛔ Y SALE AUNQUE NO HAYA NADA QUE DECIR. Un reporte que se calla los domingos
//    se ve igual que un reporte caído. Si no hay ninguna unidad confirmada, lo
//    dice con esas palabras. [[norma-la-barra-que-no-dice-que-sigue]]
//
// El destinatario vive en `configuracion.choferes_dia_tel` (uno o varios). Si
// está vacío NO se manda y NO se marca el día, para que al cargar el número el
// aviso dispare igual.
// Solo ENCOLA en `cola_mensajes`; el worker antepone la marca y envía.
//   ?dry=1 → arma y devuelve SIN encolar ni marcar (no escribe nada).
//   ?fecha=YYYY-MM-DD → solo con dry, para mirar otro día.
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function one(clave: string): Promise<string> {
  const r = await sel(`configuracion?clave=eq.${clave}&select=valor`);
  return String(r[0]?.valor ?? "");
}
async function enqueue(rows: any[]): Promise<boolean> {
  if (!rows.length) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.error("enqueue", r.status, await r.text());
  return r.ok;
}
async function yaMarcado(key: string): Promise<boolean> {
  return (await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`)).length > 0;
}
async function marcar(key: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
}

const soloDig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();
// +58 412-6514694 — se lee y se copia mejor que 12 dígitos pegados.
function telLindo(t: string): string {
  const d = soloDig(t);
  return (d.length === 12 && d.startsWith("58")) ? `+58 ${d.slice(2, 5)}-${d.slice(5)}` : (t || "");
}
// Nombre en Mayúscula Inicial: EN MAYÚSCULA TODO se lee como un grito en WhatsApp.
const titulo = (s: string) => String(s || "").toLowerCase().replace(/\b[a-záéíóúñ]/g, (c) => c.toUpperCase());
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const pedida = url.searchParams.get("fecha") || "";
  // La fecha de otro día solo se puede mirar en seco: un reporte de ayer mandado
  // hoy al IMAU sería una foto vieja presentada como la de hoy.
  const hoy = (dry && /^\d{4}-\d{2}-\d{2}$/.test(pedida))
    ? pedida
    : new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
  const [yy, mm, dd] = hoy.split("-");
  const f = new Date(`${hoy}T12:00:00Z`);
  const fechaLarga = `${DIAS[f.getUTCDay()]} ${dd}/${mm}/${yy}`;

  // ── Las unidades que cuentan ───────────────────────────────────────────────
  // ⛔ NO una lista blanca de prefijos: en esta misma casa un `PEJ-B013` quedó
  //    invisible en doce desplegables por eso. Se toman las declaradas como
  //    compactador MÁS cualquiera que hoy tenga checklist o fichaje — así una
  //    unidad nueva aparece el día que empieza a trabajar, aunque nadie le haya
  //    puesto el tipo todavía. [[norma-arreglar-el-mecanismo-no-el-caso]]
  const ucfg = await sel(`unidad_config?select=cam,placa,tipo,activo`);
  const cks = await sel(`checklist?fecha=eq.${hoy}&select=cam,conductor,hora_salida`);
  const fich = await sel(`asistencia_dia?fecha=eq.${hoy}&select=unidad,nombre,cargo,hora,empleado_id`);
  const emps = await sel(`empleados?select=id,nombre,whatsapp,tel,activo`);

  const porId: Record<string, any> = {};
  const porNombre: Record<string, any[]> = {};
  for (const e of emps) {
    if (e.id) porId[String(e.id)] = e;
    const n = norm(e.nombre);
    if (n) (porNombre[n] = porNombre[n] || []).push(e);
  }
  const telDe = (e: any) => String(e?.whatsapp || "").trim() || String(e?.tel || "").trim() || "";

  const activasHoy = new Set<string>();
  for (const c of cks) if (c.cam) activasHoy.add(String(c.cam));
  for (const a of fich) if (a.unidad) activasHoy.add(String(a.unidad));

  const unidades = ucfg
    .filter((u: any) => u.cam && u.activo !== false &&
      (/compactador/i.test(String(u.tipo || "")) || activasHoy.has(String(u.cam))))
    .sort((a: any, b: any) => String(a.cam).localeCompare(String(b.cam)));

  // ── Quién maneja cada una ──────────────────────────────────────────────────
  const ckDe: Record<string, any> = {};
  for (const c of cks) { const k = String(c.cam || ""); if (k && !ckDe[k]) ckDe[k] = c; }
  const fiDe: Record<string, any[]> = {};
  for (const a of fich) {
    if (!/chofer|conduc/i.test(String(a.cargo || ""))) continue;
    const k = String(a.unidad || ""); if (!k) continue;
    (fiDe[k] = fiDe[k] || []).push(a);
  }

  const filas = unidades.map((u: any) => {
    const cam = String(u.cam);
    const ck = ckDe[cam];
    const fi = (fiDe[cam] || [])[0];
    let nombre = "", fuente = "", tel = "";

    if (ck?.conductor && norm(ck.conductor) !== "SIN IDENTIFICAR") {
      nombre = String(ck.conductor);
      fuente = ck.hora_salida ? String(ck.hora_salida).slice(0, 5) : "";
      // El checklist guarda el NOMBRE, no el id. Si ese nombre apunta a dos
      // fichas, no se elige una: se deja sin teléfono y se dice.
      // [[norma-nombre-corto-que-apunta-a-dos-personas]]
      const cand = porNombre[norm(nombre)] || [];
      if (cand.length === 1) tel = telDe(cand[0]);
      // El fichaje del mismo día trae `empleado_id`: vínculo exacto, mejor que el texto.
      if (!tel && fi?.empleado_id && porId[String(fi.empleado_id)] && norm(fi.nombre) === norm(nombre)) {
        tel = telDe(porId[String(fi.empleado_id)]);
      }
    } else if (fi) {
      nombre = String(fi.nombre || "");
      fuente = fi.hora ? String(fi.hora).slice(11, 16) : "";
      if (fi.empleado_id && porId[String(fi.empleado_id)]) tel = telDe(porId[String(fi.empleado_id)]);
    }

    return { cam, placa: String(u.placa || ""), nombre, tel, hora: fuente };
  });

  const confirmadas = filas.filter((r) => r.nombre);
  const horas = confirmadas.map((r) => r.hora).filter(Boolean).sort();

  // ── El mensaje ─────────────────────────────────────────────────────────────
  let msg = `*CHOFERES POR UNIDAD*\n_${fechaLarga}_\n\n`;
  if (!confirmadas.length) {
    msg += `⚠️ Todavía no hay ninguna unidad con chofer confirmado para hoy.\n` +
      `Se confirma cuando el chofer revisa su unidad antes de salir del patio. ` +
      `En cuanto eso ocurra, aparece acá.\n`;
  } else {
    for (const r of filas) {
      const cortito = r.cam.replace(/^[A-Z]+-/, "");
      if (!r.nombre) { msg += `*${cortito}* · ${r.placa}\n_sin confirmar_\n`; continue; }
      msg += `*${cortito}* · ${r.placa}\n${titulo(r.nombre)}\n` +
        `${r.tel ? telLindo(r.tel) : "_sin teléfono en ficha_"}\n`;
    }
    msg += `\n_${confirmadas.length} de ${filas.length} unidades con chofer confirmado._\n`;
    if (horas.length) {
      msg += horas[0] === horas[horas.length - 1]
        ? `_Confirmado por el propio chofer al revisar su unidad, a las ${horas[0]}._\n`
        : `_Confirmado por el propio chofer al revisar su unidad, entre las ${horas[0]} y las ${horas[horas.length - 1]}._\n`;
    }
    const faltan = filas.length - confirmadas.length;
    if (faltan > 0) {
      msg += `_Las ${faltan} que dicen «sin confirmar» todavía no registraron esa revisión hoy; ` +
        `preferimos decirlo antes que darle un nombre que podría no ser el correcto._\n`;
    }
  }

  // ── Destinatarios ──────────────────────────────────────────────────────────
  // En `configuracion`, no en el código: el IMAU va a querer sumar gente y eso no
  // puede pedir un despliegue. Varios números separados por coma o salto de línea.
  const raw = String(await one("choferes_dia_tel")).replace(/["\[\]]/g, "");
  const vistos = new Set<string>();
  const tels = raw.split(/[,;\n]+/).map((s) => soloDig(s)).filter((n) => {
    if (!n || vistos.has(n)) return false; vistos.add(n); return true;
  });

  const key = `choferes_dia_${hoy}`;
  if (dry) {
    return new Response(JSON.stringify({
      ok: true, dry: true, fecha: hoy, unidades: filas.length,
      confirmadas: confirmadas.length, sin_telefono: confirmadas.filter((r) => !r.tel).length,
      destinatarios: tels.length, ya_salio_hoy: await yaMarcado(key), mensaje: msg,
    }, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  if (!tels.length) {
    // No se marca: así, el día que se cargue el número, el reporte sale igual.
    return new Response(JSON.stringify({ ok: true, sin_destinatario: true, fecha: hoy }),
      { headers: { "Content-Type": "application/json" } });
  }
  if (await yaMarcado(key)) {
    return new Response(JSON.stringify({ ok: true, ya_salio_hoy: true, fecha: hoy }),
      { headers: { "Content-Type": "application/json" } });
  }

  const ok = await enqueue(tels.map((t) => ({ telefono: t, mensaje: msg, tipo: "choferes-dia", estado: "pendiente" })));
  // Se marca SOLO si el encolado salió bien: si falla, mañana no se pierde el día.
  if (ok) await marcar(key);
  return new Response(JSON.stringify({
    ok: true, fecha: hoy, encolados: ok ? tels.length : 0, marcado: ok,
    unidades: filas.length, confirmadas: confirmadas.length,
  }), { headers: { "Content-Type": "application/json" } });
});
