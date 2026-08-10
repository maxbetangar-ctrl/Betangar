import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// BETANGAR — Supervisor de COBROS de factura (Alcaldía). Corre a diario.
//
// Qué hace, en una línea: mira el estado de cuenta del banco solo, reconoce qué cobro es cada
// crédito (porque de la factura sabe CUÁNTO tiene que entrar), lo deja cuadrado en la app y avisa.
//
// Cada factura entra en DOS depósitos: el NETO (base − retenciones) y la FIEL CUMPLIMIENTO 10%,
// días después. El motor calcula ambos montos de la factura; cuando ese monto cae en el banco, es
// ese cobro. El banco DESDE el que la Alcaldía transfiere da igual (a veces Bancamiga, a veces el
// propio BNC): el dinero cae siempre en cuentas BNC de Betangar y el estado de cuenta lo muestra.
//
// Avisa por WhatsApp (cola_mensajes) de dos cosas:
//   ✅ entró un cobro (la primera vez que se reconoce)
//   ⚠️ un cobro se pasó de tiempo (contando DÍAS HÁBILES: si transfieren un viernes, sábado y
//      domingo no cuentan — si no, avisaría en falso cada fin de semana y terminas ignorándolo)
//
// Idempotente por los dos lados: el cobro se guarda en cobros_factura con id factura+pata, y cada
// aviso queda en alertas_log. Correrlo dos veces no duplica nada. ?dry=1 = no envía ni guarda.
//
// ⛔ LO QUE ESTE MÓDULO ESCRIBIÓ MAL, Y POR QUÉ (2026-08-10) — no volver a quitar estos candados.
// Escribió 2 patas equivocadas de 36 y se dio cuenta el cruce, no él:
//
//   000637-fiel  se llevó el MISMO movimiento (ref 10263522741784, 24/06, Bs 1.308.798,35) que ya
//                era el fiel de la 000632. Nada excluía un movimiento YA COBRADO por otra factura:
//                solo se excluían las PATAS ya guardadas. En la corrida siguiente ese crédito de
//                junio volvía a estar disponible y cayó dentro del 3% del fiel de la 000637
//                (esperado 1.270.068 · diferencia 38.731 · tolerancia 39.264) **por Bs 533**.
//   000638-fiel  se llevó un TRASPASO ENTRE CUENTAS PROPIAS del 22/07 (Bs 1.946.290,40) para una
//                factura del 05/08. Dos agujeros a la vez: se aceptaba cualquier crédito sin
//                preguntar si era un cobro de la Alcaldía, y se aceptaba un cobro con fecha
//                ANTERIOR a la factura que supuestamente pagaba.
//
// Los tres candados de abajo (movimiento ya usado · solo categoria='cobro_alcaldia' · la fecha del
// cobro nunca es anterior a la de la factura) son la respuesta, y ninguno depende de acordarse.
//
// ⛔ Y LA FUENTE: se leía el banco crudo por `bnc-saldo`. Ahora se lee `bnc_movimientos`, que es
// donde `bnc-traer` deja el estado de cuenta YA CLASIFICADO y ya mezclado con el Excel y las
// notificaciones. Es la misma tabla que lee `v_cobro_facturas` — que es lo que la app muestra.
// Antes cada uno miraba su propia copia: por eso el error pudo vivir en `cobros_factura` sin que
// se viera en pantalla. Al reconocer una pata se escriben LAS DOS (`cobros_factura` +
// `bnc_movimientos.factura/pata`) en el mismo sitio, para que no puedan volver a discrepar.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HDR = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Perfil de retenciones Alcaldía — MISMOS números que money.js (RET_DEFAULT). Si algún día cambian
// allá, cambian aquí: son la definición del contrato, no una constante de conveniencia.
const RET = { iva: 0.16, retIVA: 0.75, retISLR: 0.02, retMun: 0.01, timbre: 0.001, fiel: 0.10 };
// neto = base × (1 + iva − iva×retIVA − islr − mun − timbre − fiel) = base × 0,909
const K_NETO = 1 + RET.iva - RET.iva * RET.retIVA - RET.retISLR - RET.retMun - RET.timbre - RET.fiel;

// Cuánto puede desviarse el crédito del banco respecto a lo calculado. La Alcaldía deposita días
// después de la factura y convierte a la tasa de SU día → 3%. (Verificado: la factura 000635 se
// pagó a 709,69 y la factura es del 10/07 a 721,35 = 1,70% de diferencia.)
const TOL_INGRESO = 0.03;
// Plazos en DÍAS HÁBILES antes de avisar que un cobro se atrasó.
const HAB_NETO = 3;
const HAB_FIEL = 5;

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
const ddmm = (s: string) => { const p = String(s).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
const bs = (n: number) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soloDig = (s: unknown) => String(s || "").replace(/\D/g, "");
function masDias(f: string, n: number): string {
  const p = String(f).slice(0, 10).split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Días HÁBILES entre dos fechas (excluye sábados y domingos). No contempla feriados: para un aviso
// de cortesía, un feriado suelto solo hace que avise un día antes, no un falso positivo grave.
function habilesEntre(desde: string, hasta: string): number {
  let n = 0, cur = masDias(desde, 1);
  while (cur <= hasta) {
    const dow = new Date(cur + "T12:00:00Z").getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
    cur = masDias(cur, 1);
  }
  return n;
}
// Días de calendario entre dos fechas AAAA-MM-DD (para puntuar la cercanía factura↔cobro).
function diasEntre(a: string, b: string): number {
  const t = (s: string) => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
  return Math.round(Math.abs(t(b) - t(a)) / 86400000);
}
// Ventana máxima entre la factura y su cobro. Los 35 pares buenos del histórico caen TODOS entre 0
// y 6 días; 60 deja aire de sobra para un atraso real de la Alcaldía sin abrirle la puerta a que un
// crédito de hace tres meses se haga pasar por el cobro de esta factura.
const MAX_DIAS_COBRO = 60;

type Mov = {
  id: string; fecha: string; bs: number; ref: string; desc: string; usado: boolean;
  factura: string; pata: string;
};
type Pata = {
  fact: string; pata: "neto" | "fiel"; fechaFact: string; esperadoBs: number; refAbono: string;
  mov?: Mov; yaGuardado: boolean;
};

Deno.serve(async (req) => {
  try {
    const qs = new URL(req.url).searchParams;
    const dry = qs.get("dry") === "1";
    // ?silencioso=1 → reconoce y guarda TODO lo que ya entró, sin avisarle a nadie. Es para la
    // primera corrida (poner al día el histórico sin disparar decenas de mensajes de pagos viejos).
    const silencioso = qs.get("silencioso") === "1";
    const hoy = veHoy();
    // Ventana de trabajo: 45 días atrás cubre de sobra el ciclo factura → neto → fiel.
    // ?desde=AAAA-MM-DD la amplía, para recuperar histórico viejo de una sola pasada (el BNC guarda
    // varios meses; se consulta igual en ventanas de ≤30 días). Úsalo con ?silencioso=1.
    const dParam = qs.get("desde") || "";
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : masDias(hoy, -45);

    // ── 1) Lo que la app ESPERA cobrar, calculado de cada factura ──────────────────────────────
    const abonos = await sel(`abonos?f=gte.${desde}&select=f,fact,v,m,ref&order=f.desc`);
    if (!abonos.length) return json({ ok: true, msg: "sin facturas en el rango" });
    // `abonos.m` = BASE FACTURADA, siempre. Las dos vías de registro (💵 Abonar y Confirmar Pago
    // Alcaldía) guardan lo mismo desde el fix de fuente única del 07-19; antes Confirmar Pago
    // guardaba el neto y el mismo campo significaba dos cosas. Aquí no se intenta detectar el caso
    // viejo: la tarifa vive en el localStorage del navegador, no en la BD, así que el servidor no
    // tiene con qué comprobarlo — y en producción no hay ninguna fila con el neto.
    const tasas = await sel(`tasas_diarias?fecha=gte.${desde}&select=fecha,bcv_dolar`);
    const tasaDe = (f: string) => {
      const ex = tasas.find((t: any) => String(t.fecha).slice(0, 10) === f);
      if (ex) return parseFloat(ex.bcv_dolar) || 0;
      // Sin tasa de ese día (fin de semana/feriado), la más reciente anterior.
      const prev = tasas.filter((t: any) => String(t.fecha).slice(0, 10) < f)
        .sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha)))[0];
      return prev ? parseFloat(prev.bcv_dolar) || 0 : 0;
    };

    const yaCobrado = await sel(`cobros_factura?select=id,fact,pata`);
    const esCobrado = (fact: string, pata: string) =>
      yaCobrado.some((c: any) => String(c.fact) === String(fact) && c.pata === pata);

    // ── 1b) CUADRAR LAS DOS FUENTES ANTES DE RECONOCER NADA ────────────────────────────────────
    // `bnc_movimientos` (el estado de cuenta sellado con factura+pata) MANDA sobre `cobros_factura`:
    // uno es lo que el banco dice que pasó, el otro es lo que este módulo dedujo. Cuando difieren,
    // el que se equivocó fue el que dedujo — que es exactamente lo que pasó con la 000636 y la
    // 000637. Se repara acá, en cada corrida, para que la divergencia no pueda volver a vivir
    // semanas sin que nadie la vea. Es idempotente: si ya coinciden, no escribe nada.
    const sellados = await sel(
      `bnc_movimientos?factura=not.is.null&pata=not.is.null&select=id,factura,pata,fecha,monto,referencia,concepto_banco,descripcion`,
    );
    const cfActual = await sel(`cobros_factura?select=id,fact,pata,fecha,monto_bs,referencia`);
    const reparadas = sellados.filter((s: any) => {
      const c = cfActual.find((x: any) => String(x.fact) === String(s.factura) && x.pata === s.pata);
      if (!c) return true; // el banco lo tiene cobrado y `cobros_factura` no lo sabe
      return Math.abs(Number(c.monto_bs) - Number(s.monto)) > 0.01 ||
             String(c.fecha).slice(0, 10) !== String(s.fecha).slice(0, 10);
    }).map((s: any) => ({
      id: `${s.factura}-${s.pata}`, fact: String(s.factura), pata: String(s.pata),
      fecha: String(s.fecha).slice(0, 10), banco: "BNC", referencia: String(s.referencia || ""),
      monto_bs: Number(s.monto),
      obs: `Cuadrado con el estado de cuenta: ${String(s.concepto_banco || s.descripcion || "").replace(/\s+/g, " ").trim()}`.slice(0, 300),
      creado_por: "supervisor-cobros",
    }));
    if (reparadas.length && !dry) {
      await fetch(`${SUPABASE_URL}/rest/v1/cobros_factura?on_conflict=id`, {
        method: "POST",
        headers: { ...HDR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(reparadas),
      });
      for (const r of reparadas) if (!yaCobrado.some((c: any) => c.id === r.id)) yaCobrado.push({ id: r.id, fact: r.fact, pata: r.pata });
    }

    // ⛔ Al revés NO se repara solo: una pata que `cobros_factura` da por cobrada y que el estado de
    // cuenta no respalda puede ser un cobro real que entró por fuera del BNC (para eso nació la
    // tabla) o puede ser un error de este módulo — y no hay forma de distinguirlos desde acá.
    // Borrar plata cobrada por si acaso es peor que reportarla. Se avisa y decide una persona.
    const huerfanas = cfActual.filter((c: any) =>
      !sellados.some((s: any) => String(s.factura) === String(c.fact) && s.pata === c.pata));

    const patas: Pata[] = [];
    for (const a of abonos) {
      const f = String(a.f || "").slice(0, 10);
      const mAb = Number(a.m) || 0; if (mAb <= 0) continue;
      const tasa = tasaDe(f); if (!tasa) continue;
      const base = mAb;
      const refAb = soloDig(a.ref);
      patas.push({ fact: String(a.fact), pata: "neto", fechaFact: f, refAbono: refAb, yaGuardado: esCobrado(a.fact, "neto"), esperadoBs: Math.round(base * K_NETO * tasa * 100) / 100 });
      patas.push({ fact: String(a.fact), pata: "fiel", fechaFact: f, refAbono: refAb, yaGuardado: esCobrado(a.fact, "fiel"), esperadoBs: Math.round(base * RET.fiel * tasa * 100) / 100 });
    }

    // ── 2) Lo que el BANCO dice — desde `bnc_movimientos`, NO del banco crudo ──────────────────
    // `bnc-traer` (cron 3× al día) deja acá el estado de cuenta ya mezclado (API + Excel +
    // notificaciones), deduplicado por ControlNumber y CLASIFICADO. Leer de acá en vez de pegarle a
    // `bnc-saldo` da tres cosas que antes no había: la categoría, el concepto tal como lo escribe el
    // banco, y la MISMA fuente que ve la pantalla.
    //
    // ⛔ Solo `categoria='cobro_alcaldia'`. Un traspaso entre cuentas propias de Betangar es un
    // crédito como cualquier otro y así fue como la 000638 se dio por cobrada sin estarlo.
    const crudos = await sel(
      `bnc_movimientos?tipo=eq.credito&categoria=eq.cobro_alcaldia&fecha=gte.${desde}` +
      `&select=id,fecha,monto,referencia,concepto_banco,descripcion,factura,pata&order=fecha.asc`,
    );
    const movs: Mov[] = crudos.map((m: any) => ({
      id: String(m.id),
      fecha: String(m.fecha || "").slice(0, 10),
      bs: Math.round(parseFloat(m.monto || 0) * 100) / 100,
      ref: String(m.referencia || ""),
      desc: String(m.concepto_banco || m.descripcion || "").replace(/\s+/g, " ").trim(),
      factura: String(m.factura || ""),
      pata: String(m.pata || ""),
      usado: false,
    })).filter((m: Mov) => m.bs > 0);

    // ⛔ UN MOVIMIENTO NO SE COBRA DOS VECES. Antes solo se excluían las PATAS ya guardadas, así que
    // un crédito consumido en una corrida anterior volvía a estar disponible en la siguiente. Se
    // marca como usado todo el que ya tenga dueño, por cualquiera de los dos lados:
    //   · `bnc_movimientos.factura` sellado (lo pone este módulo o el cruce), o
    //   · su referencia/monto ya escritos en `cobros_factura` (registros a mano incluidos).
    const yaCobradoFull = await sel(`cobros_factura?select=id,fact,pata,fecha,referencia,monto_bs`);
    const refsTomadas = new Set(
      yaCobradoFull.map((c: any) => `${soloDig(c.referencia)}|${Number(c.monto_bs).toFixed(2)}`),
    );
    for (const m of movs) {
      if (m.factura) { m.usado = true; continue; }
      if (refsTomadas.has(`${soloDig(m.ref)}|${m.bs.toFixed(2)}`)) m.usado = true;
    }

    // Si `bnc_movimientos` viene vacío o quedó viejo, NO se avisa de atrasos: no hay forma de saber
    // si entró o no, y avisar "no ha caído" cuando en realidad no pudimos mirar sería mentir.
    const ultimoMov = await sel(`bnc_movimientos?select=fecha&order=fecha.desc&limit=1`);
    const fechaUltimo = String(ultimoMov[0]?.fecha || "").slice(0, 10);
    const bancoFresco = !!fechaUltimo && diasEntre(fechaUltimo, hoy) <= 3;
    if (!movs.length && !bancoFresco) {
      return json({ ok: false, msg: `el estado de cuenta está viejo (último movimiento ${fechaUltimo || "ninguno"}) — no se avisa nada para no dar falsos atrasos` });
    }

    // ── 3) Reconocer: el MEJOR par primero, no el que llegue antes ──────────────────────────────
    // Antes se recorrían los movimientos en orden y cada uno se quedaba con la pata que más se le
    // pareciera en ese instante. Con las patas del 10% rondando todas el mismo monto, el orden de
    // llegada decidía — y un cobro llegó a casar con una factura de 95 días antes.
    // Ahora se puntúan TODOS los pares posibles y se resuelve el de menor puntaje, después el
    // siguiente, y así. El puntaje mezcla lo que se aleja el monto y lo que se aleja la fecha.
    const pend = () => patas.filter((p) => !p.mov && !p.yaGuardado);
    type Par = { p: Pata; m: Mov; score: number; porRef: boolean };
    const pares: Par[] = [];
    for (const p of pend()) {
      for (const m of movs) {
        if (m.usado) continue;
        // ⛔ Un cobro NO puede ser anterior a la factura que paga. Así fue como el fiel de la 000638
        // (factura del 05/08) se quedó con un movimiento del 22/07.
        if (m.fecha < p.fechaFact) continue;
        const dias = diasEntre(p.fechaFact, m.fecha);
        if (dias > MAX_DIAS_COBRO) continue;
        const dif = Math.abs(p.esperadoBs - m.bs);
        // La referencia del abono dentro de la del banco es la señal más fuerte, pero YA NO BASTA
        // por sí sola: el monto tiene que cuadrar igual. Una referencia de 6 dígitos es un trozo de
        // texto que aparece por casualidad; el monto es lo que la Alcaldía efectivamente depositó.
        const rd = soloDig(m.ref);
        const porRef = p.refAbono.length >= 6 && rd.indexOf(p.refAbono) >= 0;
        if (dif > Math.max(1, m.bs * TOL_INGRESO)) continue;
        // Puntaje: desvío relativo del monto + 1 punto por cada 10 días de distancia. Un par por
        // referencia entra con ventaja, pero compitiendo, no saltándose la cola.
        const score = dif / Math.max(1, m.bs) + dias / 1000 - (porRef ? 1 : 0);
        pares.push({ p, m, score, porRef });
      }
    }
    pares.sort((a, b) => a.score - b.score);
    for (const par of pares) {
      if (par.m.usado || par.p.mov) continue;
      par.p.mov = par.m;
      par.m.usado = true;
    }

    // ── 4) Guardar los reconocidos + avisar ────────────────────────────────────────────────────
    // Se escriben LAS DOS fuentes en el mismo sitio: `cobros_factura` (que lee la Conciliación) y
    // el sello `factura/pata` en `bnc_movimientos` (que lee `v_cobro_facturas`, o sea la pantalla).
    // Separadas fue como una pudo estar mal dos semanas sin que la otra lo notara.
    const nuevos = patas.filter((p) => p.mov && !p.yaGuardado);
    const filas = nuevos.map((p) => ({
      id: `${p.fact}-${p.pata}`, fact: p.fact, pata: p.pata,
      fecha: p.mov!.fecha || p.fechaFact, banco: "BNC", referencia: p.mov!.ref,
      monto_bs: p.mov!.bs, obs: `Reconocido solo por el supervisor: ${p.mov!.desc}`.slice(0, 300),
      creado_por: "supervisor-cobros",
    }));
    if (filas.length && !dry) {
      await fetch(`${SUPABASE_URL}/rest/v1/cobros_factura?on_conflict=id`, {
        method: "POST",
        headers: { ...HDR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(filas),
      });
      for (const p of nuevos) {
        await fetch(`${SUPABASE_URL}/rest/v1/bnc_movimientos?id=eq.${encodeURIComponent(p.mov!.id)}`, {
          method: "PATCH",
          headers: { ...HDR, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ factura: p.fact, pata: p.pata }),
        });
      }
    }

    // Atrasados: la pata no entró y ya pasaron los días hábiles de gracia. El reloj de la FIEL
    // arranca cuando entró el NETO (es lo que dispara la retención), no en la fecha de la factura.
    // ⛔ Si el estado de cuenta no está fresco NO se acusa ningún atraso: "no ha caído" y "no lo
    // hemos mirado" se ven igual desde acá, y solo uno de los dos es cierto.
    const atrasados = bancoFresco ? patas.filter((p) => {
      if (p.mov || p.yaGuardado) return false;
      if (p.pata === "neto") return habilesEntre(p.fechaFact, hoy) >= HAB_NETO;
      const neto = patas.find((x) => x.fact === p.fact && x.pata === "neto");
      const entroNeto = neto?.mov?.fecha || (neto?.yaGuardado ? p.fechaFact : "");
      if (!entroNeto) return false; // si el neto tampoco ha caído, ya se avisa por el neto
      return habilesEntre(entroNeto, hoy) >= HAB_FIEL;
    }) : [];

    // Destinatarios: socios + admin desde configuracion.whatsapp (fuente única), DEDUPE por número.
    const cfg = await sel(`configuracion?clave=eq.whatsapp&select=valor`);
    let wa: any[] = [];
    try { wa = JSON.parse(cfg[0]?.valor || "[]"); } catch { wa = []; }
    const nums = Array.from(new Set((Array.isArray(wa) ? wa : [])
      .filter((w: any) => w.num && w.activo && (w.rol === "socios" || w.rol === "admin"))
      .map((w: any) => String(w.num).replace(/[\s\-+]/g, ""))));
    if (!nums.length) nums.push("584147379886"); // fallback Máximo

    const avisos: string[] = [];
    for (const p of nuevos) {
      const key = `cobro_ok_${p.fact}_${p.pata}`;
      if (await yaAviso(key)) continue;
      // NO avisar de cobros viejos: se reconocen y se guardan igual, pero en silencio. Si no, la
      // primera corrida (o una corrida después de días caído) dispara una avalancha de mensajes
      // sobre pagos que entraron hace semanas y que Máximo ya sabe. Solo se avisa de lo FRESCO.
      // 7 días de margen: corriendo a diario lo normal es 0-1, y aguanta una semana caído.
      const viejo = habilesEntre(String(p.mov!.fecha || "").slice(0, 10), hoy) > 7 || silencioso;
      if (viejo) { if (!dry) await marcar(key); continue; }
      avisos.push(`✅ *Entró un cobro de la Alcaldía*\n\n` +
        `🧾 Factura: *${p.fact}*\n` +
        `💵 Concepto: *${p.pata === "fiel" ? "fiel cumplimiento 10%" : "pago neto"}*\n` +
        `🏦 Monto: *Bs ${bs(p.mov!.bs)}*\n` +
        `📅 Fecha: ${ddmm(p.mov!.fecha)}\n` +
        (p.mov!.ref ? `🔖 Ref: ${p.mov!.ref}\n` : "") +
        `\nQuedó conciliado solo, no hay que hacer nada.`);
      if (!dry) await marcar(key);
    }
    for (const p of atrasados) {
      // Un aviso de atraso por pata y por día: si sigue sin caer, vuelve a recordar mañana.
      const key = `cobro_tarde_${p.fact}_${p.pata}_${hoy}`;
      if (silencioso) { if (!dry) await marcar(key); continue; }
      if (await yaAviso(key)) continue;
      const dias = p.pata === "neto" ? habilesEntre(p.fechaFact, hoy) : HAB_FIEL;
      avisos.push(`⚠️ *Cobro de la Alcaldía que no ha caído*\n\n` +
        `🧾 Factura: *${p.fact}* (del ${ddmm(p.fechaFact)})\n` +
        `💵 Falta: *${p.pata === "fiel" ? "la fiel cumplimiento 10%" : "el pago neto"}*\n` +
        `🏦 Esperado: *Bs ${bs(p.esperadoBs)}*\n` +
        `⏳ Van *${dias} días hábiles* y el banco no lo refleja.\n\n` +
        `👉 Vale la pena preguntar en la Alcaldía.`);
      if (!dry) await marcar(key);
    }
    // Patas dadas por cobradas que el estado de cuenta no respalda. Un aviso por pata, UNA sola vez
    // (no lleva la fecha en la llave): si se repitiera a diario sería ruido, y un aviso que salta
    // todos los días deja de leerse.
    for (const c of huerfanas) {
      const key = `cobro_huerfano_${c.fact}_${c.pata}`;
      if (silencioso) { if (!dry) await marcar(key); continue; }
      if (await yaAviso(key)) continue;
      avisos.push(`🔎 *Un cobro registrado que el banco no respalda*\n\n` +
        `🧾 Factura: *${c.fact}* — ${c.pata === "fiel" ? "fiel cumplimiento 10%" : "pago neto"}\n` +
        `🏦 Registrado: *Bs ${bs(Number(c.monto_bs))}* del ${ddmm(String(c.fecha))}\n` +
        (c.referencia ? `🔖 Ref: ${c.referencia}\n` : "") +
        `\nO entró por un banco que el estado de cuenta no muestra, o está mal registrado.\n` +
        `👉 No se toca solo: hay que mirarlo.`);
      if (!dry) await marcar(key);
    }

    const detalle = nuevos.map((p) => ({ pata: `${p.fact}-${p.pata}`, fecha: p.mov!.fecha, monto_bs: p.mov!.bs, esperado_bs: p.esperadoBs, ref: p.mov!.ref }));
    if (dry) {
      return json({
        ok: true, dry: true, facturas: abonos.length, ultimo_movimiento: fechaUltimo, banco_fresco: bancoFresco,
        candidatos: movs.length, libres: movs.filter((m) => !m.usado).length,
        cuadradas: reparadas.map((r) => r.id), huerfanas: huerfanas.map((c: any) => c.id),
        reconocidos: nuevos.length, detalle, atrasados: atrasados.map((p) => `${p.fact}-${p.pata}`),
        destinos: nums, avisos,
      });
    }
    for (const msg of avisos) await enqueue(nums.map((n) => ({ telefono: n, mensaje: msg, tipo: "cobros", estado: "pendiente" })));
    return json({ ok: true, reconocidos: nuevos.length, detalle, cuadradas: reparadas.length, huerfanas: huerfanas.length, atrasados: atrasados.length, avisos: avisos.length, banco_fresco: bancoFresco });
  } catch (e) {
    console.error("cobros-alcaldia", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});

function json(b: unknown) { return new Response(JSON.stringify(b, null, 2), { headers: { "Content-Type": "application/json" } }); }
