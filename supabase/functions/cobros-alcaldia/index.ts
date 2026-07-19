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
// El BNC rechaza rangos de más de 30 días (409) y devuelve CERO movimientos de todas las cuentas.
function ventanas30(desde: string, hasta: string): string[][] {
  const out: string[][] = [];
  let ini = desde;
  while (ini <= hasta) {
    let fin = masDias(ini, 29); if (fin > hasta) fin = hasta;
    out.push([ini, fin]);
    ini = masDias(fin, 1);
  }
  return out.length ? out : [[desde, hasta]];
}
// El BNC devuelve la fecha como dd/mm/aaaa.
const fechaBNC = (s: unknown) => {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : t.slice(0, 10);
};

type Mov = { fecha: string; bs: number; ref: string; desc: string; usado: boolean };
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
    // ¿`abonos.m` es la BASE facturada o el NETO? Regla CAUSAL: si la factura está en
    // `pagos_alcaldia`, la escribió guardarPagoAlcaldia con m:neto; si no, la tecleó la oficina en
    // Abonar (viajes × tarifa = base). No se adivina con la tarifa: la tarifa vive en el
    // localStorage del navegador, no en la BD, así que aquí no hay forma de saberla.
    const palc = await sel(`pagos_alcaldia?select=factura`);
    const esNetoFact = (fact: string) => palc.some((p: any) => String(p.factura) === String(fact));
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

    const patas: Pata[] = [];
    for (const a of abonos) {
      const f = String(a.f || "").slice(0, 10);
      const mAb = Number(a.m) || 0; if (mAb <= 0) continue;
      const tasa = tasaDe(f); if (!tasa) continue;
      const base = esNetoFact(a.fact) ? mAb / K_NETO : mAb;
      const refAb = soloDig(a.ref);
      patas.push({ fact: String(a.fact), pata: "neto", fechaFact: f, refAbono: refAb, yaGuardado: esCobrado(a.fact, "neto"), esperadoBs: Math.round(base * K_NETO * tasa * 100) / 100 });
      patas.push({ fact: String(a.fact), pata: "fiel", fechaFact: f, refAbono: refAb, yaGuardado: esCobrado(a.fact, "fiel"), esperadoBs: Math.round(base * RET.fiel * tasa * 100) / 100 });
    }

    // ── 2) Lo que el BANCO dice ────────────────────────────────────────────────────────────────
    const movs: Mov[] = [];
    let bancoOk = false;
    const cuentasMal: string[] = [];
    try {
      const rs = await fetch(`${SUPABASE_URL}/functions/v1/bnc-saldo`, {
        method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saldo" }), signal: AbortSignal.timeout(30000),
      });
      const ds = await rs.json();
      if (ds?.ok && ds.saldos) {
        bancoOk = true;
        for (const acc of Object.keys(ds.saldos)) {
          for (const [d, h] of ventanas30(desde, hoy)) {
            try {
              const rm = await fetch(`${SUPABASE_URL}/functions/v1/bnc-saldo`, {
                method: "POST", headers: { ...HDR, "Content-Type": "application/json" },
                body: JSON.stringify({ action: "movimientos_fecha", account_number: acc, start_date: d, end_date: h }),
                signal: AbortSignal.timeout(40000),
              });
              const dm = await rm.json();
              if (!(dm?.ok && Array.isArray(dm.movimientos))) { cuentasMal.push(`${acc} ${d}`); continue; }
              for (const m of dm.movimientos) {
                if (String(m.BalanceDelta || "").toLowerCase().indexOf("ingreso") < 0) continue;
                movs.push({
                  fecha: fechaBNC(m.Date),
                  bs: Math.round(parseFloat(m.Amount || 0) * 100) / 100,
                  ref: [m.ReferenceA, m.ReferenceB, m.ReferenceC, m.ReferenceD].filter(Boolean).join(" / "),
                  desc: String(m.Concept || m.Type || "").replace(/\s+/g, " ").trim(),
                  usado: false,
                });
              }
            } catch { cuentasMal.push(`${acc} ${d}`); }
          }
        }
      }
    } catch { bancoOk = false; }
    // Las notificaciones del webhook se SUMAN (se pierden a menudo, pero llegan al instante).
    try {
      const notif = await sel(`bnc_notificaciones?fecha_recibido=gte.${desde}&select=referencia,monto,fecha_recibido,descripcion`);
      for (const n of notif) {
        const amt = Math.round(parseFloat(n.monto || 0) * 100) / 100;
        const f = String(n.fecha_recibido || "").slice(0, 10);
        const rd = soloDig(n.referencia);
        const dup = movs.some((m) =>
          (rd.length >= 6 && soloDig(m.ref).indexOf(rd) >= 0) ||
          (Math.abs(m.bs - amt) <= Math.max(1, amt * 0.005) && m.fecha === f));
        if (!dup) movs.push({ fecha: f, bs: amt, ref: String(n.referencia || ""), desc: String(n.descripcion || "Notificación del banco"), usado: false });
      }
    } catch { /* las notificaciones son complemento, no fuente única */ }

    // Si no se pudo ver el banco, NO se avisa de atrasos: no hay forma de saber si entró o no, y
    // avisar "no ha caído" cuando en realidad no pudimos mirar sería mentirle a Máximo.
    if (!bancoOk && !movs.length) return json({ ok: false, msg: "no se pudo leer el banco — no se avisa nada para no dar falsos atrasos" });

    // ── 3) Reconocer: primero por REFERENCIA, después por el monto MÁS CERCANO ──────────────────
    const pend = () => patas.filter((p) => !p.mov && !p.yaGuardado);
    for (const m of movs) {
      if (m.usado) continue;
      const rd = soloDig(m.ref); if (rd.length < 6) continue;
      const p = pend().find((x) => x.refAbono.length >= 6 && rd.indexOf(x.refAbono) >= 0);
      if (p) { p.mov = m; m.usado = true; }
    }
    for (const m of movs) {
      if (m.usado) continue;
      const tol = Math.max(1, m.bs * TOL_INGRESO);
      let mejor: Pata | undefined, dMejor = Infinity;
      for (const p of pend()) {
        const d = Math.abs(p.esperadoBs - m.bs);
        if (d <= tol && d < dMejor) { dMejor = d; mejor = p; }
      }
      if (mejor) { mejor.mov = m; m.usado = true; }
    }

    // ── 4) Guardar los reconocidos + avisar ────────────────────────────────────────────────────
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
    }

    // Atrasados: la pata no entró y ya pasaron los días hábiles de gracia. El reloj de la FIEL
    // arranca cuando entró el NETO (es lo que dispara la retención), no en la fecha de la factura.
    const atrasados = patas.filter((p) => {
      if (p.mov || p.yaGuardado) return false;
      if (p.pata === "neto") return habilesEntre(p.fechaFact, hoy) >= HAB_NETO;
      const neto = patas.find((x) => x.fact === p.fact && x.pata === "neto");
      const entroNeto = neto?.mov?.fecha || (neto?.yaGuardado ? p.fechaFact : "");
      if (!entroNeto) return false; // si el neto tampoco ha caído, ya se avisa por el neto
      return habilesEntre(entroNeto, hoy) >= HAB_FIEL;
    });

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

    if (dry) return json({ ok: true, dry: true, facturas: abonos.length, movimientos: movs.length, reconocidos: nuevos.length, atrasados: atrasados.length, destinos: nums, avisos });
    for (const msg of avisos) await enqueue(nums.map((n) => ({ telefono: n, mensaje: msg, tipo: "cobros", estado: "pendiente" })));
    return json({ ok: true, reconocidos: nuevos.length, atrasados: atrasados.length, avisos: avisos.length, cuentasMal });
  } catch (e) {
    console.error("cobros-alcaldia", String(e));
    return json({ ok: false, error: String((e as any)?.message || e) });
  }
});

function json(b: unknown) { return new Response(JSON.stringify(b, null, 2), { headers: { "Content-Type": "application/json" } }); }
