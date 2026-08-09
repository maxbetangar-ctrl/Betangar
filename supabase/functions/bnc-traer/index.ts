// ════════════════════════════════════════════════════════════════════════════════════════════════
// BETANGAR — TRAER EL ESTADO DE CUENTA DEL BANCO, SOLO
//
// De dónde sale: hasta el 2026-08-09 los movimientos del banco solo entraban si una persona abría
// la pantalla de Conciliación. Máximo lo pidió explícito, y es la parte que más le interesó.
//
// ── LO QUE SE COMPROBÓ ANTES DE ESCRIBIR ESTO (y que corrige dos creencias) ──────────────────────
//  1. El BNC NO limita la antigüedad, limita el TAMAÑO DE LA VENTANA a 30 días. Pidiendo de a 30
//     entrega desde el 23/03/2026 (que es cuando abre la cuenta) hasta hoy. O sea: lo que no se
//     traiga hoy se puede volver a pedir mañana. NO hay pérdida diaria, como se creyó el 08/08.
//  2. Cada movimiento trae `ControlNumber` —único, verificado sobre 2.412 movimientos de las 4
//     cuentas— y `PreviousBalance`. Esa es la llave. La llave "obvia" (fecha+monto+referencia)
//     fundía 307 filas y perdía Bs 9.811.821,57 en silencio, porque un pago de nómina en lote son
//     decenas de filas idénticas en esos tres campos.
//
// ── DECISIONES, Y POR QUÉ ───────────────────────────────────────────────────────────────────────
//  · NO habla con el banco. Llama a `bnc-saldo`, que ya lo hace y es la única que tiene las
//    credenciales. Si mañana el BNC cambia su API, se toca UN archivo, no dos.
//  · VENTANA CON SOLAPAMIENTO (7 días por defecto). El banco a veces registra un movimiento con
//    uno o dos días de atraso: pedir solo "ayer" lo dejaría afuera para siempre. Traer de más no
//    cuesta nada porque el guardado es idempotente por ControlNumber.
//  · NO PISA lo que ya está. `ignoreDuplicates` = ON CONFLICT DO NOTHING. Los movimientos viejos
//    llevan en la descripción la clasificación que escribió la administración («… — PAGO DE
//    NÓMINA», «E/S EL PALOTAL - GASOIL 2.289 LITROS»), y la API del BNC NO da eso: devuelve el
//    texto crudo de la transferencia. Un upsert normal borraría ese trabajo en cada corrida.
//  · CLASIFICA AL TERMINAR. Sin llamar a `bnc_clasificar()`, lo que entra queda con categoría NULL
//    y no aparece en ningún cuadro: se perdería en silencio, que es peor que no haberlo traído.
//  · DEJA CONSTANCIA DE CADA CORRIDA en `bnc_sync_log`, incluidas las que fallan. Si solo se
//    guardaran las buenas, una racha de fallos se vería igual que "todavía no le tocó correr".
//  · NO MANDA UN WHATSAPP POR CORRIDA. El resumen diario lo manda el vigilante (?vigilar=1). Un
//    aviso que salta todos los días deja de leerse, y entonces no avisa de nada.
//
// Uso:
//   POST /bnc-traer                    → últimos 7 días, guarda
//   POST /bnc-traer?dry=1              → dice qué traería, sin escribir nada
//   POST /bnc-traer?dias=30            → otra ventana
//   POST /bnc-traer?desde=&hasta=      → un rango exacto (se parte solo en tramos de 30 días)
//   POST /bnc-traer?vigilar=1          → NO trae: revisa si el traído sigue vivo y reporta
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const DIAS_VENTANA = 7;      // solapamiento: el banco a veces registra con atraso
const TOPE_BNC = 30;         // el BNC rechaza rangos mayores (HTTP 409)
const HORAS_ALARMA = 36;     // sin una corrida buena en 36 h, algo está roto

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SRK);

const hoyISO = () => new Date().toISOString().slice(0, 10);
const dMas = (f: string, n: number) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// El BNC devuelve dd/mm/aaaa. Sin convertir, cualquier comparación de fechas falla en silencio.
const iso = (s: string) => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || '').slice(0, 10); };
const lim = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function bncSaldo(body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/bnc-saldo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SRK, Authorization: `Bearer ${SRK}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return await r.json();
}

// Los teléfonos salen del roster de `configuracion.whatsapp`, igual que el resto de las alertas.
// Hardcodear un número acá lo dejaría fuera de sincronía el día que alguien cambie de rol.
//
// ⚠️ LOS ROLES SON LOS DE BETANGAR, y hay que mirarlos, no suponerlos. La primera versión de esto
// pedía 'directivo' y 'superadmin' —que son los roles de la APP— y el roster de WhatsApp no tiene
// ninguno de los dos: usa 'socios', 'admin', 'rrhh', 'mecanica', 'operativo', 'contadora'. El
// vigilante habría corrido todos los días sin escribirle a NADIE, y ese silencio se lee igual que
// «todo en orden», que es justo lo que esta pieza existe para evitar.
const ROLES_AVISO = ['socios', 'admin'];   // quién se entera de que el banco no entra

async function telefonosDe(roles: string[]): Promise<string[]> {
  const r = await sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle();
  let roster: any = [];
  try { roster = typeof r.data?.valor === 'string' ? JSON.parse(r.data.valor) : (r.data?.valor ?? []); } catch { roster = []; }
  const tels = (Array.isArray(roster) ? roster : [])
    .filter((w: any) => w?.num && w.activo !== false && roles.includes(w.rol))
    .map((w: any) => String(w.num).replace(/[\s\-+]/g, ''));
  // Que quede en el log del que se queda mudo. Sin esto, "no le llegó a nadie" es indistinguible
  // de "no había nada que avisar".
  if (!tels.length) console.error(`SIN DESTINATARIOS para los roles ${JSON.stringify(roles)} — el aviso no le llega a nadie. Roles en el roster: ${JSON.stringify([...new Set((Array.isArray(roster) ? roster : []).map((w: any) => w?.rol))])}`);
  return tels;
}

async function encolar(tels: string[], mensaje: string, tipo: string) {
  if (!tels.length) return 0;
  const filas = tels.map((t) => ({ telefono: t, mensaje, tipo, estado: 'pendiente' }));
  const ins = await sb.from('cola_mensajes').insert(filas);
  if (ins.error) { console.error('cola_mensajes:', ins.error.message); return 0; }
  return filas.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';

  // ── MODO VIGILANTE ────────────────────────────────────────────────────────────────────────────
  // Manda el parte TODOS LOS DÍAS, salga bien o mal. Un aviso que solo aparece cuando algo falla
  // no prueba que el vigilante siga vivo: si el vigilante se muere, el silencio se lee como
  // "todo en orden". Es la misma lección que dejó el sync de Geppetto cayéndose sin que nadie
  // se enterara.
  if (url.searchParams.get('vigilar') === '1') {
    const est = await sb.rpc('bnc_sync_estado');
    if (est.error) return json({ ok: false, error: est.error.message }, 500);
    const e = (Array.isArray(est.data) ? est.data[0] : est.data) ?? {};
    const horas = Number(e.horas_sin_ok ?? 999);
    const caido = horas > HORAS_ALARMA || !e.ultima_ok;

    const msg = caido
      ? `🔴 BETANGAR — el estado de cuenta del banco NO se está trayendo.\n\n` +
        `Última vez que entró bien: ${e.ultima_ok ? new Date(e.ultima_ok).toLocaleString('es-VE') : 'nunca'}\n` +
        `Van ${horas} horas.\n` +
        (e.ultimo_error ? `Último error: ${String(e.ultimo_error).slice(0, 180)}\n` : '') +
        `\nMientras esté así, los movimientos nuevos no entran al sistema. Los del banco NO se pierden ` +
        `(se pueden volver a pedir), pero la Utilidad Real y la Carpeta del Auditor se quedan viejas.`
      : `✅ BETANGAR — estado de cuenta al día.\n\n` +
        `Corridas en 24 h: ${e.corridas_24h}${Number(e.fallidas_24h) ? ` (${e.fallidas_24h} con error)` : ''}\n` +
        `Movimientos nuevos guardados: ${e.nuevos_24h}\n` +
        `Última corrida buena: ${new Date(e.ultima_ok).toLocaleString('es-VE')}`;

    const tels = await telefonosDe(ROLES_AVISO);
    const enviados = dry ? 0 : await encolar(tels, msg, 'bnc_vigilante');
    // `destinatarios` viaja en la respuesta a propósito: es lo que permite ver desde afuera que el
    // vigilante tiene a quién hablarle. Si da 0, el vigilante corre y no sirve para nada.
    return json({ ok: tels.length > 0, vigilante: true, caido, horas, destinatarios: tels.length, enviados, dry, sin_destinatarios: tels.length === 0, mensaje: msg, estado: e });
  }

  // ── MODO TRAER ────────────────────────────────────────────────────────────────────────────────
  const hasta = url.searchParams.get('hasta') || hoyISO();
  const dias = Number(url.searchParams.get('dias') || DIAS_VENTANA);
  const desde = url.searchParams.get('desde') || dMas(hasta, -Math.max(1, dias) + 1);
  const origen = url.searchParams.get('origen') || 'cron';

  // La fila del log se abre ANTES de empezar. Si el proceso se muere a la mitad queda una corrida
  // sin `fin` y sin `error`, que es exactamente la señal de "se colgó" — y se puede ver.
  let logId: number | null = null;
  if (!dry) {
    const ins = await sb.from('bnc_sync_log').insert([{ origen, desde, hasta }]).select('id').maybeSingle();
    if (ins.error) console.error('sync_log insert:', ins.error.message);
    logId = ins.data?.id ?? null;
  }
  const cerrar = async (campos: Record<string, unknown>) => {
    if (dry || !logId) return;
    const up = await sb.from('bnc_sync_log').update({ fin: new Date().toISOString(), ...campos }).eq('id', logId);
    if (up.error) console.error('sync_log update:', up.error.message);
  };

  try {
    // Las cuentas salen de la tabla, no de una lista en el código: si mañana se abre otra, se
    // agrega una fila. Si la tabla está vacía se cae a lo que reporte el banco.
    const cp = await sb.from('bnc_cuentas_propias').select('cuenta');
    let cuentas: string[] = (cp.data ?? []).map((c: any) => String(c.cuenta));
    const saldo = await bncSaldo({ action: 'saldo' });
    if (!saldo?.ok) {
      const err = `el BNC no respondió al saldo: ${lim(saldo?.error || saldo?.respuesta?.message || JSON.stringify(saldo)).slice(0, 200)}`;
      await cerrar({ error: err });
      return json({ ok: false, error: err }, 502);
    }
    if (!cuentas.length) cuentas = Object.keys(saldo.saldos ?? {});

    // Ventanas de ≤30 días: el BNC rechaza rangos mayores y devuelve CERO movimientos de TODAS las
    // cuentas, o sea que sin esto la conciliación se haría contra un banco vacío.
    const ventanas: [string, string][] = [];
    for (let ini = desde; ini <= hasta;) {
      let fin = dMas(ini, TOPE_BNC - 1); if (fin > hasta) fin = hasta;
      ventanas.push([ini, fin]); ini = dMas(fin, 1);
    }

    const filas: Record<string, unknown>[] = [];
    const vistos = new Set<string>();
    let cuentasOk = 0; const cuentasMal: string[] = [];

    for (const acc of cuentas) {
      // try/catch POR CUENTA: si una falla, las demás igual se traen. Un solo fallo abortando el
      // lote dejaría la corrida marcada como buena pero con datos incompletos.
      try {
        let algo = false, fallo = false;
        for (const [d, h] of ventanas) {
          const r = await bncSaldo({ action: 'movimientos_fecha', account_number: acc, start_date: d, end_date: h });
          if (!r?.ok || !Array.isArray(r.movimientos)) { fallo = true; continue; }
          algo = true;
          for (const m of r.movimientos) {
            const cn = String(m?.ControlNumber ?? '').trim();
            if (!cn || vistos.has(cn)) continue;   // sin ControlNumber no hay llave: no se guarda
            vistos.add(cn);
            const refs = [m.ReferenceA, m.ReferenceB, m.ReferenceC, m.ReferenceD].filter((x: unknown) => x && String(x) !== '0').join(' / ');
            filas.push({
              id: 'bnc_' + cn,
              fecha: iso(m.Date),
              monto: Math.abs(Number(m.Amount) || 0),
              tipo: m.BalanceDelta === 'Egreso' ? 'debito' : 'credito',
              descripcion: lim(m.Concept) || lim(m.Type) || null,
              referencia: refs || null,
              control_number: cn,
              cuenta: acc,
              saldo_anterior: m.PreviousBalance == null ? null : Number(m.PreviousBalance),
            });
          }
        }
        if (algo && !fallo) cuentasOk++;
        else if (algo) { cuentasOk++; cuentasMal.push(acc + ' (parcial)'); }
        else cuentasMal.push(acc);
      } catch (e) { cuentasMal.push(acc); console.error('cuenta', acc, String(e)); }
    }

    // Cuántos son NUEVOS de verdad. Se mide antes de escribir para poder informarlo con honestidad:
    // `traidos` alto y `nuevos` cero es lo NORMAL (la ventana se solapa a propósito).
    let nuevos = 0;
    if (filas.length) {
      const cns = filas.map((f) => String(f.control_number));
      const yaHay = new Set<string>();
      for (let i = 0; i < cns.length; i += 400) {
        const q = await sb.from('bnc_movimientos').select('control_number').in('control_number', cns.slice(i, i + 400));
        (q.data ?? []).forEach((x: any) => yaHay.add(String(x.control_number)));
      }
      nuevos = cns.filter((c) => !yaHay.has(c)).length;
    }

    if (dry) {
      return json({ ok: true, dry: true, desde, hasta, ventanas: ventanas.length, cuentas: cuentas.length, cuentas_ok: cuentasOk, cuentas_mal: cuentasMal, traidos: filas.length, nuevos, muestra: filas.slice(0, 3) });
    }

    let guardados = 0, errGuardar: string | null = null;
    for (let i = 0; i < filas.length; i += 200) {
      const tanda = filas.slice(i, i + 200);
      const res = await sb.from('bnc_movimientos').upsert(tanda, { onConflict: 'control_number', ignoreDuplicates: true });
      if (res.error) { errGuardar = res.error.message; console.error('upsert:', errGuardar); break; }
      guardados += tanda.length;
    }

    let clasificados = 0;
    if (guardados && !errGuardar) {
      const rc = await sb.rpc('bnc_clasificar');
      if (rc.error) { errGuardar = 'clasificar: ' + rc.error.message; console.error(errGuardar); }
      else clasificados = Number(rc.data ?? 0);
    }

    // Una cuenta que no se pudo leer ES un error, aunque las otras hayan entrado: si no, la corrida
    // queda marcada como buena y el vigilante no dice nada de los datos que faltan.
    const error = errGuardar || (cuentasMal.length ? `no se pudieron leer: ${cuentasMal.join(', ')}` : null);
    await cerrar({ cuentas_ok: cuentasOk, cuentas_mal: cuentasMal.length, traidos: filas.length, nuevos, error, detalle: { ventanas: ventanas.length, clasificados, cuentas_mal: cuentasMal } });

    // Solo se avisa cuando hay algo que decir. El parte de "todo bien" lo manda el vigilante una
    // vez al día; uno por corrida sería ruido y dejaría de leerse.
    if (error) {
      const tels = await telefonosDe(ROLES_AVISO);
      await encolar(tels, `⚠️ BETANGAR — problema trayendo el estado de cuenta del banco (${desde} → ${hasta}).\n\n${String(error).slice(0, 220)}\n\nLos movimientos del banco NO se pierden: se pueden volver a pedir. Pero hasta que se resuelva, lo nuevo no entra al sistema.`, 'bnc_traer_error');
    }

    return json({ ok: !error, desde, hasta, cuentas: cuentas.length, cuentas_ok: cuentasOk, cuentas_mal: cuentasMal, traidos: filas.length, nuevos, guardados, clasificados, error });
  } catch (e) {
    await cerrar({ error: String(e).slice(0, 400) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
