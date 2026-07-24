// ════════════════════════════════════════════════════════════════════════════════════════════════
// SUPERVISOR AUTOMÁTICO DE COMBUSTIBLE — revisa lo cargado y avisa los errores a quien corresponde.
//
// Pedido de Máximo (2026-07-21): "un cron que si ve duplicados o algo mal introducido le avise a las
// personas involucradas, como el chofer y quien sea que esté por encima de él… algo que supervise y
// avise errores".
//
// A QUIÉN LE AVISA, y por qué así:
//   • Al CHOFER solo le llegan los ERRORES DE CARGA que él puede corregir (falta la medición, el km
//     quedó al revés, la altura no cuadra con la tabla). En tono de "revisá esto", nunca acusatorio.
//   • Los HALLAZGOS OPERATIVOS (rodó sin jornada registrada, entró combustible sin asentar) van a
//     los jefes: no acusan a nadie, señalan un agujero de registro.
//   • Lo que podría ser SUSTRACCIÓN va SOLO a mecánica/operativo/socios, y hoy está EN PAUSA
//     (ver AVISAR_SUSTRACCION). Un WhatsApp automático no puede insinuarle a una persona que se
//     robó algo — puede ser perfectamente una regla mal leída.
//
// Idempotente por `alertas_log.alert_key`: cada aviso sale UNA vez aunque el cron corra de nuevo.
// Solo ENCOLA en cola_mensajes; el worker `procesar_cola_wassenger` lo envía con la marca de la
// empresa. Fecha en America/Caracas.  ?dry=1 → devuelve lo que mandaría, sin encolar ni marcar.
//
// ⚠️ Esta lógica es GEMELA de la del módulo en pantalla (app.js, `_acAnomalias`). Si se toca una, se
// toca la otra: si el dashboard dice una cosa y el WhatsApp otra, se pierde la confianza en las dos.
// Norma del repo: verificar el CONSUMIDOR.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

// ── TOLERANCIA: sale del INSTRUMENTO, no de un número redondo ───────────────────────────────────
// Antes había un fijo de 15 L y estaba mal dos veces (auditoría 2026-07-24): la regla se lee en
// centímetros enteros y 1 cm = 13 L en el tanque del camión, así que la tolerancia era más fina que
// la propia marca de la regla y cualquier diferencia de 2 cm salía como alerta de robo.
//   TOL = 2 × √( (S(h_a)·σ)² + (S(h_b)·σ)² + (1,5% de lo despachado)² )   [2 sigmas ≈ 95%]
const SIGMA_CM = 1;     // error real de UNA lectura: redondeo + camión no nivelado + chapoteo
const TOL_PISO = 8;     // piso, para que una tabla plana no genere una tolerancia ridícula

// ⚠️ AVISO DE SUSTRACCIÓN EN PAUSA (2026-07-24, decisión de Máximo).
// La merma estacionada salía por WhatsApp con nombre y apellido apoyada en números que no
// aguantaban: de 26 casos de julio, 12 eran camiones que SÍ rodaron entre las dos mediciones (hasta
// 208 km) — la regla afirmaba "un camión estacionado no consume" sin haber mirado nunca el
// odómetro. Eso ya está corregido acá abajo (precondiciones) y quedan 3 casos de verdad.
// Aun así el aviso sigue callado hasta que la cubicación del tanque sea un aforo real y no una
// división (600 L ÷ 46 cm), y hasta que se vuelva a registrar el combustible que ENTRA. Se sigue
// calculando y se sigue viendo en Combustible → Auditoría. No borrar sin leer esto.
const AVISAR_SUSTRACCION = false;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  // Por defecto revisa AYER (el día ya cerrado). ?fecha=YYYY-MM-DD para revisar otro.
  const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const fecha = url.searchParams.get('fecha') || new Date(new Date(hoyVE + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const previo = new Date(new Date(fecha + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

  const [cfgT, med, gas, ck, emps, waCfg, logs] = await Promise.all([
    sb.from('combustible_tanques_config').select('*'),
    sb.from('combustible_mediciones').select('*').gte('fecha', previo).lte('fecha', fecha),
    sb.from('gasoil').select('*').gte('f', previo).lte('f', fecha),
    sb.from('checklist').select('fecha,cam,conductor,km_salida,km_entrada').gte('fecha', previo).lte('fecha', fecha),
    sb.from('empleados').select('nombre,whatsapp,tel,activo,cargo'),
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('alertas_log').select('alert_key').like('alert_key', 'comb_%'),
  ]);
  if (cfgT.error) return json({ ok: false, error: cfgT.error.message }, 500);

  const tanques = (cfgT.data || []).map((t: any) => {
    let tabla = t.tabla_cubicacion;
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla); } catch { tabla = null; } }
    return { id: t.id, tipo: t.tipo, hmax: num(t.altura_max_cm), tabla };
  });
  if (!tanques.length) return json({ ok: true, nota: 'esta empresa no usa cubicación — nada que auditar', avisos: 0 });

  const yaEnviado = new Set((logs.data || []).map((l: any) => l.alert_key));
  const marcar: string[] = [];
  const filas: any[] = [];

  // Teléfono del chofer por nombre (los checklists guardan el nombre, no el id).
  // El rango ̀-ͯ son las tildes que suelta normalize('NFD'). Van escapadas a proposito:
  // escritas como caracteres sueltos se rompen al copiar el archivo entre herramientas.
  const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const telDe = (nombre: string): string => {
    const n = norm(nombre); if (!n) return '';
    const e = (emps.data || []).find((x: any) => x.activo !== false && norm(x.nombre) === n)
           || (emps.data || []).find((x: any) => x.activo !== false && norm(x.nombre).startsWith(n.split(' ')[0]) && n.split(' ').length > 1 && norm(x.nombre).includes(n.split(' ')[1]));
    return e ? String(e.whatsapp || e.tel || '').trim() : '';
  };
  // Jefes: del roster por rol. Mecánica y operativo son los que atienden esto; socios ve el resumen.
  let roster: any[] = [];
  try { roster = JSON.parse(String(waCfg.data?.valor || '[]')); } catch { roster = []; }
  const telsRol = (roles: string[]) => (Array.isArray(roster) ? roster : [])
    .filter((w: any) => w.num && w.activo !== false && roles.includes(w.rol))
    .map((w: any) => String(w.num));
  const jefes = [...new Set([...telsRol(['mecanica', 'operativo', 'socios'])])];

  // ── Cubicación: altura ➜ litros, interpolando (los tanques del galpón NO son lineales) ──
  const puntos = (tq: any): number[] => Object.keys(tq?.tabla || {}).map(Number).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  const cubicar = (tq: any, cm: any): number | null => {
    const h = num(cm); if (h == null || !tq?.tabla) return null;
    const t = tq.tabla;
    if (t[String(h)] != null) return num(t[String(h)]);
    const ps = puntos(tq);
    if (!ps.length) return null;
    if (h <= ps[0]) return num(t[String(ps[0])]);
    if (h >= ps[ps.length - 1]) return num(t[String(ps[ps.length - 1])]);
    for (let i = 1; i < ps.length; i++) {
      if (h <= ps[i]) {
        const h0 = ps[i - 1], h1 = ps[i], l0 = num(t[String(h0)])!, l1 = num(t[String(h1)])!;
        return Math.round((l0 + (h - h0) * (l1 - l0) / (h1 - h0)) * 100) / 100;
      }
    }
    return null;
  };
  // Litros por centímetro A ESA ALTURA: lo que traduce el error de lectura (cm) a litros.
  const litrosPorCm = (tq: any, cm: any): number | null => {
    const h = num(cm); if (h == null || !tq?.tabla) return null;
    const ps = puntos(tq); if (ps.length < 2) return null;
    let i = 1; while (i < ps.length - 1 && ps[i] < h) i++;
    const l0 = num(tq.tabla[String(ps[i - 1])]), l1 = num(tq.tabla[String(ps[i])]);
    if (l0 == null || l1 == null || ps[i] === ps[i - 1]) return null;
    return Math.abs(l1 - l0) / (ps[i] - ps[i - 1]);
  };
  const tol = (tq: any, hA: any, hB: any, v?: number): number => {
    let sA = litrosPorCm(tq, hA), sB = litrosPorCm(tq, hB);
    if (sA == null && sB == null) return TOL_PISO * 2;
    if (sA == null) sA = sB;
    if (sB == null) sB = sA;
    const eA = sA! * SIGMA_CM, eB = sB! * SIGMA_CM, eV = (v || 0) * 0.015;
    return Math.max(TOL_PISO, Math.round(2 * Math.sqrt(eA * eA + eB * eB + eV * eV) * 10) / 10);
  };
  // Una altura fuera del rango físico NO se cubica: se descarta (antes 264 cm en un tanque de 46
  // entraba topeada a 600 L y contaminaba el cuadre como si fuera un dato bueno).
  const alturaOk = (tq: any, cm: any): boolean => {
    const h = num(cm); if (h == null) return false;
    return tq?.hmax ? (h >= 0 && h <= tq.hmax) : h >= 0;
  };
  const tqDe = (m: any) => tanques.find((x) => String(x.id) === String(m.tanque_id)) || tanques.find((x) => x.tipo === 'vehiculo') || tanques[0];
  const diaSiguiente = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    const d = new Date(String(a).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10) === String(b).slice(0, 10);
  };

  // ── DEDUPE: una sola medición por unidad+fecha+momento, la ÚLTIMA por created_at ──
  // Si el chofer volvió a cargar es porque está corrigiendo. Antes se colapsaban solo las idénticas
  // y dos alturas distintas quedaban las dos, ensuciando el cuadre del día siguiente.
  const porMomento: Record<string, any[]> = {};
  (med.data || []).slice()
    .sort((a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .forEach((m: any) => {
      const k = [m.vehiculo_id, String(m.fecha).slice(0, 10), m.momento].join('|');
      (porMomento[k] = porMomento[k] || []).push(m);
    });
  const medUnica: any[] = [];
  const corregidas = new Set<string>();
  let dupIguales = 0;
  const dupPorUnidad: Record<string, number> = {};
  Object.keys(porMomento).forEach((k) => {
    const lista = porMomento[k];
    const alturas = new Set(lista.map((m: any) => String(num(m.altura_cm))));
    dupIguales += (lista.length - alturas.size);
    if (alturas.size > 1) corregidas.add(k);
    if (lista.length > 1 && String(lista[0].fecha).slice(0, 10) === fecha) {
      const v = String(lista[0].vehiculo_id);
      dupPorUnidad[v] = (dupPorUnidad[v] || 0) + (lista.length - 1);
    }
    medUnica.push(lista[lista.length - 1]);
  });

  // ── Revisión por unidad del día ──
  const delDia = medUnica.filter((m: any) => String(m.fecha).slice(0, 10) === fecha && tqDe(m)?.tipo !== 'galpon');
  const unidades = [...new Set(delDia.map((m: any) => String(m.vehiculo_id)).filter(Boolean))];
  const ckDia = (ck.data || []).filter((c: any) => String(c.fecha).slice(0, 10) === fecha);
  const ckPrevio = (ck.data || []).filter((c: any) => String(c.fecha).slice(0, 10) === previo);
  const errores: any[] = [];    // los que SÍ se le avisan al chofer
  const hallazgos: any[] = [];  // operativos, a los jefes: no acusan a nadie
  const graves: any[] = [];     // posible sustracción: solo jefes, y hoy en pausa
  const entraron: any[] = [];   // combustible que entró sin registrarse

  // Un 0 en el odómetro NO es un odómetro en cero: es el checklist sin cerrar o sin dato.
  const km = (v: any): number | null => { const n = num(v); return (n != null && n > 0) ? n : null; };
  const despDe = (u: string, f: string) => (gas.data || [])
    .filter((gg: any) => String(gg.cam) === u && String(gg.f).slice(0, 10) === f && String(gg.tipo_operacion || '') !== 'compra')
    .reduce((s: number, gg: any) => s + (num(gg.lit) || 0), 0);

  for (const u of unidades.concat(ckDia.map((c: any) => String(c.cam)).filter((x) => !unidades.includes(x)))) {
    const ms = delDia.filter((m: any) => String(m.vehiculo_id) === u);
    const sal = ms.find((m: any) => String(m.momento) === 'salida');
    const lle = ms.find((m: any) => String(m.momento) === 'llegada');
    const c = ckDia.find((x: any) => String(x.cam) === u);
    const chofer = String(c?.conductor || sal?.registrado_por || lle?.registrado_por || '').trim();
    const kmS = km(c?.km_salida), kmE = km(c?.km_entrada);
    const trabajo = kmS != null && kmE != null && kmE > kmS;

    if (dupPorUnidad[u]) errores.push({ u, chofer, tipo: 'duplicado', txt: `la medición del tanque quedó cargada ${dupPorUnidad[u] + 1} veces` });
    if (trabajo && !sal) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la SALIDA' });
    if (trabajo && !lle) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la LLEGADA' });
    if (kmS != null && kmE != null && kmE < kmS) errores.push({ u, chofer, tipo: 'km', txt: `el kilometraje de llegada (${fmt(kmE)}) es menor que el de salida (${fmt(kmS)})` });
    if (kmS != null && kmE == null && fecha < hoyVE) errores.push({ u, chofer, tipo: 'km', txt: 'quedó sin anotar el kilometraje de entrada (el checklist del día no se cerró)' });

    for (const m of ms) {
      const tq = tqDe(m), cm = num(m.altura_cm), rec = num(m.litros_calculados);
      if (!alturaOk(tq, cm)) {
        errores.push({ u, chofer: String(m.registrado_por || chofer), tipo: 'altura', txt: `la medición de ${m.momento} dice ${fmt(cm)} cm y ese tanque llega hasta ${fmt(tq?.hmax)} cm` });
        continue;   // lectura inválida: no se compara con la tabla ni se usa para cuadrar
      }
      const calc = cubicar(tq, cm);
      if (calc != null && rec != null && Math.abs(rec - calc) > 2) {
        errores.push({ u, chofer: String(m.registrado_por || chofer), tipo: 'tabla', txt: `en la medición de ${m.momento} (${fmt(cm)} cm) los litros guardados (${fmt(rec)}) no coinciden con la tabla (${fmt(calc)})` });
      }
    }

    // ── LO QUE PASÓ ENTRE LA LLEGADA DE AYER Y LA SALIDA DE HOY ──
    // Para poder hablar de FALTANTE tienen que ser verdad TODAS: días consecutivos · el odómetro
    // dice que no rodó · las dos lecturas válidas y sin corrección encima · sin despacho · fuera
    // de 2·TOL. Si el odómetro avanzó, no se habla de merma: se avisa que rodó sin registrarse.
    const lleAyer = medUnica.find((m: any) => String(m.vehiculo_id) === u && String(m.fecha).slice(0, 10) === previo && String(m.momento) === 'llegada');
    const kmEayer = km(ckPrevio.find((x: any) => String(x.cam) === u)?.km_entrada);

    if (kmEayer != null && kmS != null && (kmS - kmEayer) > 1) {
      hallazgos.push({ u, tipo: 'R11',
        txt: `marcaba ${fmt(kmEayer)} km al llegar el ${fmtFecha(previo)} y ${fmt(kmS)} km al salir el ${fmtFecha(fecha)}: son ${fmt(kmS - kmEayer)} km hechos sin planilla ni checklist` });
    } else if (sal && lleAyer && diaSiguiente(previo, fecha) && kmEayer != null && kmS != null
               && alturaOk(tqDe(sal), sal.altura_cm) && alturaOk(tqDe(lleAyer), lleAyer.altura_cm)
               && !corregidas.has([u, fecha, 'salida'].join('|')) && !corregidas.has([u, previo, 'llegada'].join('|'))) {
      const a = cubicar(tqDe(sal), sal.altura_cm), b = cubicar(tqDe(lleAyer), lleAyer.altura_cm);
      const desp = despDe(u, fecha);
      if (a != null && b != null) {
        const d = Math.round((a - b - desp) * 100) / 100;
        const t1 = tol(tqDe(sal), lleAyer.altura_cm, sal.altura_cm, desp);
        // Sin nombre de chofer: de noche el custodio es el PATIO, no la persona que manejó.
        if (d < -2 * t1) graves.push({ u, litros: d, txt: `quedó el ${fmtFecha(previo)} con ${fmt(b)} L y amaneció con ${fmt(a)} L: faltan ${fmt(Math.abs(d))} L, con el odómetro igual y sin despacho (el error de la regla explica hasta ±${fmt(t1)} L)` });
        else if (d > 2 * t1) entraron.push({ u, litros: d });
      }
    }

    // Llegó con MÁS de lo que salió: cargó durante el día y no quedó asentado.
    if (sal && lle && alturaOk(tqDe(sal), sal.altura_cm) && alturaOk(tqDe(lle), lle.altura_cm)
        && !corregidas.has([u, fecha, 'salida'].join('|')) && !corregidas.has([u, fecha, 'llegada'].join('|'))) {
      const s2 = cubicar(tqDe(sal), sal.altura_cm), l2 = cubicar(tqDe(lle), lle.altura_cm);
      const desp2 = despDe(u, fecha);
      if (s2 != null && l2 != null) {
        const consumo = s2 + desp2 - l2;
        if (consumo < -2 * tol(tqDe(sal), sal.altura_cm, lle.altura_cm, desp2)) entraron.push({ u, litros: Math.abs(consumo) });
      }
    }
  }

  // Todo el combustible que entró sin registrarse se dice UNA vez y junto: el problema no es cada
  // camión, es que la carga no se está asentando. De a una línea taparía lo poco que hay que mirar.
  if (entraron.length) {
    const totL = entraron.reduce((s: number, x: any) => s + (x.litros || 0), 0);
    const cams = [...new Set(entraron.map((x: any) => x.u))];
    hallazgos.push({ u: '', tipo: 'R13',
      txt: `entraron unos ${fmt(totL)} L a ${cams.length} unidad(es) (${cams.join(', ')}) sin ninguna carga registrada. Los tanques subieron y en el sistema no figura de dónde salió ese combustible — ese gasto no está entrando a la Utilidad Real` });
  }

  // ── Mensajes al CHOFER (solo errores de carga, agrupados por persona) ──
  const porChofer: Record<string, any[]> = {};
  errores.forEach((e) => { if (e.chofer) (porChofer[e.chofer] = porChofer[e.chofer] || []).push(e); });
  for (const ch of Object.keys(porChofer)) {
    const tel = telDe(ch);
    const key = `comb_chofer_${fecha}_${norm(ch).replace(/ /g, '_')}`;
    if (yaEnviado.has(key)) continue;
    if (!tel) continue;   // sin teléfono no se puede avisar (se informa en el resumen a los jefes)
    const lista = porChofer[ch].map((e) => `• ${e.u}: ${e.txt}`).join('\n');
    const msg = `Hola ${primerNombre(ch)}, revisá por favor lo del ${fmtFecha(fecha)}:\n\n${lista}\n\n` +
      `No es un reclamo: son datos que quedaron incompletos o raros y sin ellos no se puede cuadrar el combustible del día. ` +
      `Si podés corregirlo en el sistema, mejor; si no, avisale al encargado para que lo ajuste. Gracias.`;
    filas.push({ telefono: tel, mensaje: msg, tipo: 'auditoria' });
    marcar.push(key);
  }

  // ── Resumen a los JEFES ──
  const keyJefes = `comb_jefes_${fecha}`;
  const gravesAvisables = AVISAR_SUSTRACCION ? graves : [];
  if (!yaEnviado.has(keyJefes) && (errores.length || hallazgos.length || gravesAvisables.length)) {
    let msg = `🔎 Revisión del combustible — ${fmtFecha(fecha)}\n`;
    if (gravesAvisables.length) {
      msg += `\n🔴 PARA REVISAR (${gravesAvisables.length}):\n` + gravesAvisables.map((x) => `• ${x.u}: ${x.txt}`).join('\n') + '\n';
    }
    if (hallazgos.length) {
      msg += `\n🟠 Registro que falta (${hallazgos.length}):\n` + hallazgos.map((x) => `• ${x.u ? x.u + ': ' : ''}${x.txt}`).join('\n') + '\n';
    }
    if (errores.length) {
      const sinTel = [...new Set(errores.filter((e) => e.chofer && !telDe(e.chofer)).map((e) => primerNombre(e.chofer)))];
      msg += `\n🟡 Datos por corregir (${errores.length}):\n` + errores.slice(0, 12).map((e) => `• ${e.u}: ${e.txt}`).join('\n');
      if (errores.length > 12) msg += `\n…y ${errores.length - 12} más.`;
      msg += `\n\nA cada chofer se le avisó lo suyo.`;
      if (sinTel.length) msg += ` Sin teléfono cargado (no se les pudo avisar): ${sinTel.join(', ')}.`;
    }
    // Si hay posible faltante pero el aviso está en pausa, no se esconde: se dice que existe y
    // dónde mirarlo, sin nombrar a nadie. Callar la acusación no es callar el dato.
    if (!AVISAR_SUSTRACCION && graves.length) {
      msg += `\n\nℹ️ Quedaron ${graves.length} caso(s) de combustible sin cuadrar. No se detallan acá ni se le atribuyen a nadie: la medición del tanque se está recalibrando. Están en Combustible → Auditoría.`;
    }
    msg += `\n\nEl detalle completo está en Combustible → Auditoría.`;
    jefes.forEach((t) => filas.push({ telefono: t, mensaje: msg, tipo: 'auditoria' }));
    marcar.push(keyJefes);
  }

  const resumen = { fecha, duplicados: dupIguales, corregidas: corregidas.size, errores: errores.length, hallazgos: hallazgos.length, graves: graves.length };
  if (dry) return json({ ok: true, dry: true, ...resumen, encolaria: filas.length, muestra: filas.slice(-2) });
  if (!filas.length) return json({ ok: true, ...resumen, avisos: 0, nota: 'nada que avisar' });

  const ins = await sb.from('cola_mensajes').insert(filas);
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  if (marcar.length) await sb.from('alertas_log').insert([...new Set(marcar)].map((k) => ({ alert_key: k })));
  return json({ ok: true, ...resumen, avisos: filas.length });
});

function num(v: any): number | null { const n = parseFloat(v); return isFinite(n) ? n : null; }
function fmt(n: any): string { return (n == null) ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }); }
function fmtFecha(f: string): string { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
function primerNombre(n: string): string {
  const t = String(n || '').trim().split(/[ ,]+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
