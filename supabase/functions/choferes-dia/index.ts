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
async function rpc(fn: string, body: any): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) { console.error("rpc", fn, r.status, await r.text()); return []; }
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
const lista = (xs: string[]) => xs.length < 2 ? (xs[0] || "")
  : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
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

  // ── ⛔ ¿SALIÓ DE VERDAD A TRABAJAR? ────────────────────────────────────────
  // Máximo, 21/10/2026: «ese reporte tiene que estar anclado a que lleguen
  // realmente unidades que salieron a trabajar… si una unidad no salió dice
  // salieron 11 de 12 unidades».
  //
  // ⛔ EL CHECKLIST NO PRUEBA QUE SALIÓ: prueba que el chofer revisó el camión.
  //    Un camión revisado y dejado en el patio tiene checklist igual. La prueba
  //    de que salió es que SE MOVIÓ: GPS con velocidad real.
  //
  // ⛔ LO AGRUPA LA BASE, NO ESTA FUNCIÓN. `btg_salidas_del_dia` devuelve, por
  //    unidad: si tiene equipo GPS y a qué hora de Venezuela se movió por primera
  //    vez. Leer las posiciones crudas desde acá ya falló: PostgREST corta en
  //    1000 filas y `gps_posiciones` tiene ~600 por unidad POR DÍA, así que el
  //    mensaje salió diciendo que once unidades no tienen GPS. El tope no avisa.
  //    [[norma-la-barra-que-no-dice-que-sigue]]
  //
  // ⛔ Y las que NO tienen equipo (B011 y B012, fuera de la cuenta del proveedor
  //    desde agosto) no se listan a mano: la base las deduce de quién reportó
  //    algo en los últimos 7 días. El día que el proveedor las conecte, esto se
  //    entera solo. [[norma-arreglar-el-mecanismo-no-el-caso]]
  const salidas = await rpc("btg_salidas_del_dia", { p_fecha: hoy });
  const salioA: Record<string, string> = {};
  const conEquipo = new Set<string>();
  for (const s of salidas) {
    const c = String(s.cam || ""); if (!c) continue;
    if (s.tiene_equipo) conEquipo.add(c);
    if (s.primera_salida) salioA[c] = String(s.primera_salida);
  }

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

    // ⛔ «Salió» = SE MOVIÓ. Para las que no tienen equipo GPS el aparato no
    //    puede decir nada, así que vale la hora de salida que registró el chofer
    //    — y abajo el mensaje aclara de dónde salió ese dato, para que el IMAU no
    //    crea que todas están confirmadas igual.
    const tieneEquipo = conEquipo.has(cam);
    const salio = tieneEquipo ? !!salioA[cam] : !!(ck?.hora_salida);
    const horaSalida = tieneEquipo ? (salioA[cam] || "") : String(ck?.hora_salida || "").slice(0, 5);

    return { cam, placa: String(u.placa || ""), nombre, tel, hora: fuente, salio, horaSalida, tieneEquipo };
  });

  const salieron = filas.filter((r) => r.salio);
  const noSalieron = filas.filter((r) => !r.salio);
  const sinEquipoQueSalieron = salieron.filter((r) => !r.tieneEquipo);
  const horas = salieron.map((r) => r.horaSalida).filter(Boolean).sort();

  // ── El mensaje ─────────────────────────────────────────────────────────────
  // ⛔ Solo se listan las que SALIERON: el IMAU usa esto para llamar al chofer de
  //    una unidad que está en la calle. Llenar la lista con camiones que no
  //    salieron es darles números que no sirven y esconder los que sí.
  let msg = `*CHOFERES POR UNIDAD*\n_${fechaLarga}_\n\n`;
  if (!salieron.length) {
    msg += `⚠️ Al momento de este reporte *no ha salido ninguna unidad* todavía.\n` +
      `En cuanto salgan, aparecen acá con su chofer y su número.\n`;
  } else {
    for (const r of salieron) {
      const cortito = r.cam.replace(/^[A-Z]+-/, "");
      msg += `*${cortito}* · ${r.placa}\n`;
      msg += r.nombre
        ? `${titulo(r.nombre)}\n${r.tel ? telLindo(r.tel) : "_sin teléfono en ficha_"}\n`
        : `_salió, pero sin chofer identificado_\n`;
    }
    msg += `\n*Salieron ${salieron.length} de ${filas.length} unidades.*\n`;
    if (horas.length) {
      msg += horas[0] === horas[horas.length - 1]
        ? `_Salida registrada a las ${horas[0]}._\n`
        : `_Salidas entre las ${horas[0]} y las ${horas[horas.length - 1]}._\n`;
    }
  }
  if (noSalieron.length) {
    msg += `\n_No ${noSalieron.length === 1 ? "salió" : "salieron"}: ` +
      `${lista(noSalieron.map((r) => r.cam.replace(/^[A-Z]+-/, "")))} ` +
      `(al momento de este reporte)._\n`;
  }
  if (sinEquipoQueSalieron.length) {
    msg += `\n_${sinEquipoQueSalieron.map((r) => r.cam.replace(/^[A-Z]+-/, "")).join(" y ")}: ` +
      `${sinEquipoQueSalieron.length === 1 ? "su salida se toma" : "sus salidas se toman"} ` +
      `del registro del chofer, no del GPS._\n`;
  }

  // ── Destinatarios ──────────────────────────────────────────────────────────
  // En `configuracion`, no en el código: el IMAU va a querer sumar gente y eso no
  // puede pedir un despliegue. Varios números separados por coma o salto de línea.
  const raw = String(await one("choferes_dia_tel")).replace(/["\[\]]/g, "");
  const vistos = new Set<string>();
  const tels = raw.split(/[,;\n]+/).map((s) => soloDig(s)).filter((n) => {
    if (!n || vistos.has(n)) return false; vistos.add(n); return true;
  });

  // ── ⛔ ¿EL DESTINO ESTÁ AUTORIZADO? ────────────────────────────────────────
  // 22/10/2026, el PRIMER día automático: el reporte se armó, se encoló… y el
  // worker lo BLOQUEÓ — «destino no autorizado: +584146058764». Hay una lista
  // blanca (`wa_destinos_permitidos`) y el IMAU no estaba en ella porque no es
  // empleado. El IMAU se quedó sin su reporte y nos enteramos porque Máximo lo
  // reclamó a las 11.
  //
  // ⛔ Y LA PRUEBA DE AYER NO PODÍA CAZARLO: se probó punta a punta apuntando el
  //    envío al número de MÁXIMO, que es empleado y por eso ya estaba
  //    autorizado. Probar el camino con OTRO destinatario no es probar el
  //    camino. [[norma-probar-el-camino-no-la-pieza]]
  //
  // Acá no se autoriza a nadie —eso es decisión de quien configura, y una lista
  // blanca que se auto-rellena deja de ser una lista blanca—: se AVISA, y se
  // avisa nombrando el daño («el IMAU no va a recibir su reporte»), no el
  // síntoma («un número no autorizado»), que es lo que el vigilante de la cola
  // ya dijo a las 8:15 y nadie pudo conectar con esto.
  // [[norma-un-mensaje-negativo-debe-decir-cual-causa]]
  const permitidos = tels.length
    ? await sel(`wa_destinos_permitidos?telefono_canon=in.(${tels.map((t) => t.slice(-10)).join(",")})&select=telefono_canon`)
    : [];
  const okCanon = new Set(permitidos.map((p: any) => String(p.telefono_canon)));
  const sinPermiso = tels.filter((t) => !okCanon.has(t.slice(-10)));

  const key = `choferes_dia_${hoy}`;
  if (dry) {
    return new Response(JSON.stringify({
      ok: true, dry: true, fecha: hoy, unidades: filas.length,
      salieron: salieron.length, no_salieron: noSalieron.map((r) => r.cam),
      sin_telefono: salieron.filter((r) => r.nombre && !r.tel).length,
      destinatarios: tels.length, sin_permiso: sinPermiso, ya_salio_hoy: await yaMarcado(key), mensaje: msg,
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

  const filasCola: any[] = tels.map((t) => ({ telefono: t, mensaje: msg, tipo: "choferes-dia", estado: "pendiente" }));
  // El aviso va a quien atiende las alarmas de esta base, que SÍ está autorizado.
  if (sinPermiso.length) {
    const alarma = soloDig(await one("alarma_tel"));
    if (alarma) {
      filasCola.push({
        telefono: alarma, tipo: "alerta", estado: "pendiente",
        mensaje: `🚨 El reporte de choferes de hoy NO le va a llegar al IMAU.

` +
          `El número ${lista(sinPermiso.map(telLindo))} no está autorizado para recibir mensajes ` +
          `en esta base, así que el envío se va a quedar trancado.

` +
          `Se arregla agregándolo en la lista de destinos permitidos. El reporte queda guardado: ` +
          `en cuanto se autorice, sale.`,
      });
    }
  }
  const ok = await enqueue(filasCola);
  // Se marca SOLO si el encolado salió bien: si falla, mañana no se pierde el día.
  if (ok) await marcar(key);
  return new Response(JSON.stringify({
    ok: true, fecha: hoy, encolados: ok ? tels.length : 0, marcado: ok,
    unidades: filas.length, salieron: salieron.length,
  }), { headers: { "Content-Type": "application/json" } });
});
