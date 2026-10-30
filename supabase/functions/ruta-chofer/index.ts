import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

// ══════════════════════════════════════════════════════════════════════════════
//  ruta-chofer — a cada chofer, en PDF, qué calles de SU zona quedaron sin pasar.
//
//  POR QUÉ EXISTE (pedido de Máximo, 30/10/2026): «avísale a cada chofer con un PDF
//  por dónde de su ruta no pasó y qué le quedó sin limpiar».
//
//  ⛔ EL ORDEN IMPORTÓ Y SE RESPETÓ. Primero se rehizo el reparto con lo que ELLOS
//  recorrieron —«ellos quieren que sus rutas estén así»— y recién después salió este
//  aviso. Al revés, el PDF le habría reclamado a cada chofer por una ruta que no acepta,
//  que es justo la queja que lo originó.
//
//  ⛔ SOLO SE LE ESCRIBE A QUIEN TIENE ALGO PENDIENTE. Un mensaje que dice «no tenés
//  nada» enseña a ignorar los que sí importan, y el que completó su zona no necesita
//  que se lo avisen por WhatsApp. Los que completaron salen en la respuesta de la
//  función, para que quien la corra lo vea.
//
//  ⛔ Y SOLO LAS CALLES QUE EL CHOFER PUEDE UBICAR: con nombre y de 100 m o más. El
//  callejero de OpenStreetMap trae tramos sin nombre de 9, 28 o 55 metros —fragmentos de
//  geometría, no calles—, y una hoja que dice «te quedó un tramo de 9 metros sin nombre»
//  no se puede cumplir y hace quedar mal al informe entero. El 30/10 eran 38 de 60.
//  ⚠️ Los descartados NO se esconden: la respuesta dice cuántos quedaron fuera y por qué.
//  [[norma-falta-de-dato-no-es-un-dato]] [[betangar-callejero-sin-nombres]]
//
//  📌 EL PDF NO LLEVA EMOJI. Helvetica/WinAnsi no los tiene y pdf-lib revienta al dibujar
//  uno. Misma razón que en `resumen-socios`.
//
//  Uso:  POST /ruta-chofer                      -> calcula, arma, sube y encola
//        POST /ruta-chofer?dry=1                -> calcula y arma, sin subir ni encolar
//        POST /ruta-chofer?pdf=1&cam=JAC-B001   -> devuelve ESE PDF en crudo, para mirarlo
//        POST /ruta-chofer?dia=2026-10-30       -> otro día (por omisión, hoy en Venezuela)
// ══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const MIN_METROS = 100;        // menos que esto, el chofer no lo puede ubicar
const FRANJA_DESDE = 8;        // hora de Venezuela
const FRANJA_HASTA = 20;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 1), { status: s, headers: { "Content-Type": "application/json" } });

async function sel(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) { console.error("sel", path, r.status, await r.text()); return []; }
  return await r.json();
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) { console.error("rpc", fn, r.status, await r.text()); return []; }
  return await r.json();
}
async function cfg(clave: string): Promise<any> {
  const r = await sel(`configuracion?select=valor&clave=eq.${clave}`);
  const v = r[0]?.valor; if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
async function yaAviso(key: string): Promise<boolean> {
  return (await sel(`alertas_log?alert_key=eq.${encodeURIComponent(key)}&select=alert_key`)).length > 0;
}
async function marcar(key: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/alertas_log`, {
    method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ alert_key: key }),
  });
}
const horaVE = () => new Date(Date.now() - 4 * 3600 * 1000).getUTCHours();
const hoyVE = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
const ddmm = (f: string) => `${f.slice(8)}/${f.slice(5, 7)}`;

// ⛔ Lo que Helvetica/WinAnsi no tiene, no se dibuja: se cambia. Sin esto, un nombre de
// calle con un carácter raro voltea el PDF entero y el aviso no sale para NADIE.
// ⛔ `doc.save()` devuelve `Uint8Array` y Deno NO lo acepta ni como cuerpo de Response ni
// como parte de un Blob (su `buffer` puede ser SharedArrayBuffer). Se copia a un
// ArrayBuffer propio una vez y se usa en los dos lugares. Sin esto no compila.
const cuerpo = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

const limpio = (s: unknown) =>
  String(s ?? "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim();

// ── EL PDF de un chofer ───────────────────────────────────────────────────────
async function armarPdf(d: {
  empresa: string; parroquia: string; dia: string; cam: string; chofer: string;
  zona: number; calles: number; km: number; hechas: number;
  pendientes: { nombre: string; metros: number }[];
  noEntro: boolean; ocultas: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pag = doc.addPage([595, 842]);              // A4
  const neg = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const tinta = rgb(0.1, 0.1, 0.12), suave = rgb(0.42, 0.42, 0.46);
  let y = 790;
  const esc = (t: string, x: number, f = reg, s = 11, c = tinta) =>
    pag.drawText(limpio(t), { x, y, size: s, font: f, color: c });

  esc(d.empresa, 48, neg, 15); y -= 20;
  esc(`${d.parroquia}  -  ${ddmm(d.dia)}`, 48, reg, 11, suave); y -= 34;

  esc(`${d.cam}   ${d.chofer}`, 48, neg, 13); y -= 18;
  esc(`Zona ${d.zona}  -  ${d.calles} calles  -  ${d.km.toFixed(1)} km`, 48, reg, 11, suave); y -= 30;

  esc(`Recorrio hoy:  ${d.hechas} de ${d.calles}`, 48, reg, 12); y -= 18;
  esc(`Quedo sin pasar:  ${d.pendientes.length}`, 48, neg, 12); y -= 26;

  if (d.noEntro) {
    // ⛔ ESTA LINEA NO ES CORTESIA. Sin ella, una hoja con 15 calles sin pasar se lee como
    // un reclamo por algo que el chofer no hizo mal: el 30/10 este camion se paso el dia
    // en la carretera al vertedero de La Concepcion. Un numero sin su motivo acusa.
    for (const l of [
      "Segun el registro del GPS, esta unidad no entro a la parroquia este dia:",
      "estuvo en el acarreo al vertedero. La zona quedo sin recorrer por eso,",
      "no por el trabajo del dia.",
    ]) { esc(l, 48, reg, 10, suave); y -= 14; }
    y -= 12;
  }

  if (!d.pendientes.length) { esc("Zona completa.", 48, neg, 12); }
  else {
    esc("Calles de su zona por las que no paso:", 48, neg, 11); y -= 20;
    for (const p of d.pendientes) {
      if (y < 70) { y = 790; doc.addPage([595, 842]); }
      esc(`-  ${p.nombre}`, 56, reg, 11);
      pag.drawText(`${Math.round(p.metros)} m`, { x: 470, y, size: 10, font: reg, color: suave });
      y -= 16;
    }
  }

  if (d.ocultas > 0) {
    y -= 14;
    esc(`(${d.ocultas} tramo(s) mas quedaron sin pasar, sin nombre en el callejero o`, 48, reg, 9, suave);
    y -= 12;
    esc(`de menos de ${MIN_METROS} m: no se listan porque no se pueden ubicar en la calle.)`, 48, reg, 9, suave);
  }

  y = 52;
  esc("Tomado del registro de GPS de la unidad.", 48, reg, 9, suave);
  return await doc.save();
}

Deno.serve(async (req) => {
  try {
    const u = new URL(req.url);
    const dry = u.searchParams.get("dry") === "1";
    const soloPdf = u.searchParams.get("pdf") === "1";
    const camPdf = u.searchParams.get("cam");
    const dia = u.searchParams.get("dia") || hoyVE();

    const empresa = limpio((await cfg("empresa"))?.nombre || "Inversiones Betangar, C.A.");

    // La cobertura la contesta el producto, no una consulta propia: dos piezas que
    // responden "que quedo sin pasar" tienen que responder lo mismo.
    const cobTodo = await rpc("zona_cobertura_del_dia", { p_fecha: dia });
    if (!cobTodo.length) return json({ ok: true, dia, nota: "sin cobertura calculada para ese dia" });

    // ⛔ SOLO LAS PARROQUIAS QUE SALIERON ESE DIA. `zona_cobertura_del_dia` devuelve las
    //    zonas de TODAS las parroquias donde el camion tiene sector, y un camion tiene uno
    //    en cada una. Sin este filtro, el 30/10 (viernes, sale Caracciolo) el PDF le decia
    //    a B008 «18 de 76 calles» sumandole sus zonas de Santa Lucia y Venancio Pulgar, que
    //    NO SE TRABAJAN LOS VIERNES — o sea un reclamo por algo que no tenia que hacer.
    //    Lo destapo el ensayo con `dry=1`; leyendo el codigo no se veia.
    const salieron = new Set(
      (await rpc("cronograma_del_dia", { p_fecha: dia }))
        .map((c: any) => c.parroquia).filter(Boolean),
    );
    const cob = cobTodo.filter((f: any) => salieron.has(f.parroquia));
    if (!cob.length) {
      return json({ ok: true, dia, enviado: false,
        parroquias_del_dia: [...salieron],
        nota: "ninguna zona de las parroquias que salieron hoy tiene cobertura calculada" });
    }

    const choferes = await rpc("chofer_del_dia", { p_fecha: dia });
    const quien: Record<string, any> = {};
    for (const c of choferes) quien[c.cam] = c;

    // Agrupado por camion. `parroquia` sale del dato, no de un parametro: si un dia salen
    // dos parroquias, cada chofer recibe la suya.
    const por: Record<string, any> = {};
    for (const f of cob) {
      const k = f.cam;
      por[k] ??= {
        cam: k, zona: f.zona, parroquia: f.parroquia, calles: 0, km: 0,
        hechas: 0, pendientes: [] as any[], ocultas: 0,
      };
      por[k].calles++; por[k].km += Number(f.metros || 0) / 1000;
      if (f.hecho) { por[k].hechas++; continue; }
      const nom = limpio(f.nombre);
      if (nom && Number(f.metros) >= MIN_METROS) por[k].pendientes.push({ nombre: nom, metros: Number(f.metros) });
      else por[k].ocultas++;
    }

    const conPendiente = Object.values(por).filter((p: any) => p.pendientes.length > 0);
    const completos = Object.values(por).filter((p: any) => p.pendientes.length === 0);

    const datos = (p: any) => ({
      empresa, parroquia: limpio(p.parroquia), dia, cam: p.cam,
      chofer: limpio((quien[p.cam]?.nombre || "").split(" ").slice(0, 2).join(" ")) || "(chofer no declarado)",
      zona: p.zona, calles: p.calles, km: p.km, hechas: p.hechas,
      pendientes: p.pendientes, noEntro: p.hechas === 0, ocultas: p.ocultas,
    });

    // ── Mirar UN PDF antes de soltar nada ────────────────────────────────────
    if (soloPdf) {
      const p: any = camPdf ? por[camPdf] : conPendiente[0];
      if (!p) return json({ ok: false, error: `no hay datos para ${camPdf || "ninguna unidad"}`, unidades: Object.keys(por) }, 404);
      const pdf = cuerpo(await armarPdf(datos(p)));
      return new Response(pdf, { headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ruta-${p.cam}-${dia}.pdf"`,
      }});
    }

    const resumen = {
      ok: true, dia, dry,
      con_pendientes: conPendiente.map((p: any) => ({
        cam: p.cam, zona: p.zona, chofer: limpio(quien[p.cam]?.nombre || ""),
        hechas: p.hechas, de: p.calles, sin_pasar: p.pendientes.length,
        no_listadas: p.ocultas, no_entro: p.hechas === 0,
      })),
      // ⛔ Los que completaron se NOMBRAN acá aunque no reciban mensaje: si no, no se
      //    distingue "completo" de "no se calculo".
      completaron: completos.map((p: any) => ({ cam: p.cam, de: p.calles, no_listadas: p.ocultas })),
      enviados: [] as any[], frenados: [] as any[],
    };

    if (dry) {
      // Se arman igual, para que el ensayo pruebe el PDF y no solo la cuenta.
      for (const p of conPendiente) {
        const pdf = await armarPdf(datos(p));
        resumen.enviados.push({ cam: (p as any).cam, bytes: pdf.length, dry: true });
      }
      return json(resumen);
    }

    // ⛔ LA FRANJA ES DEL DESTINATARIO. Un PDF de trabajo a las 3 de la mañana es una
    //    molestia. Fuera de la franja NO se manda y se dice por que: un aviso que no
    //    salio tiene que verse.
    const h = horaVE();
    if (h < FRANJA_DESDE || h >= FRANJA_HASTA) {
      return json({ ...resumen, enviado: false,
        motivo: `fuera de la franja ${FRANJA_DESDE}-${FRANJA_HASTA} (son las ${h} en Venezuela). No se mando nada.` });
    }

    const w = await cfg("wassenger");
    if (!w?.token) return json({ ok: false, error: "falta configuracion.wassenger.token" }, 500);

    for (const p of conPendiente as any[]) {
      const clave = `ruta-chofer-${p.cam}-${dia}`;
      if (await yaAviso(clave)) { resumen.frenados.push({ cam: p.cam, motivo: "ya se le mando hoy" }); continue; }

      const tel = quien[p.cam]?.wa || quien[p.cam]?.telefono;
      if (!tel) { resumen.frenados.push({ cam: p.cam, motivo: "no hay telefono del chofer del dia" }); continue; }

      const pdf = await armarPdf(datos(p));
      const nombre = `ruta-${p.cam}-${dia}.pdf`;

      // ⛔ PRIMERO EL ARCHIVO, DESPUES EL MENSAJE. Si el mensaje sale y el archivo no, el
      //    chofer queda con el aviso de un documento que no puede abrir.
      const fd = new FormData();
      fd.append("file", new Blob([cuerpo(pdf)], { type: "application/pdf" }), nombre);
      const sub = await fetch("https://api.wassenger.com/v1/files", {
        method: "POST", headers: { Token: w.token }, body: fd,
      });
      const subTxt = await sub.text();
      if (!sub.ok && sub.status !== 201) {
        resumen.frenados.push({ cam: p.cam, motivo: `no se pudo subir el PDF (HTTP ${sub.status})`, detalle: subTxt.slice(0, 200) });
        continue;
      }
      let fid: string | null = null;
      try { const j = JSON.parse(subTxt); fid = j?.id || (Array.isArray(j) ? j[0]?.id : null); } catch { /* abajo */ }
      if (!fid) { resumen.frenados.push({ cam: p.cam, motivo: "el proveedor no devolvio el id del archivo" }); continue; }

      const texto = p.hechas === 0
        ? `${p.cam}: el registro del GPS no muestra recorrido en la parroquia el ${ddmm(dia)}. ` +
          `Va el detalle de la zona en el archivo.`
        : `${p.cam}: del ${ddmm(dia)} quedaron ${p.pendientes.length} ` +
          `${p.pendientes.length === 1 ? "calle" : "calles"} de su zona sin pasar. Van en el archivo.`;

      const enc = await fetch(`${SUPABASE_URL}/rest/v1/cola_mensajes`, {
        method: "POST", headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify([{
          telefono: tel, mensaje: texto, tipo: "ruta_chofer", estado: "pendiente",
          media_file: fid, media_nombre: nombre, ref: clave,
        }]),
      });
      if (!enc.ok) {
        resumen.frenados.push({ cam: p.cam, motivo: `no se pudo encolar (HTTP ${enc.status})` });
        continue;
      }
      let id: number | null = null;
      try { id = (await enc.json())[0]?.id ?? null; } catch { /* da igual */ }
      await marcar(clave);
      resumen.enviados.push({ cam: p.cam, chofer: limpio(quien[p.cam]?.nombre || ""), tel, cola_id: id, calles: p.pendientes.length });
    }

    return json(resumen);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
