// ════════════════════════════════════════════════════════════════════════════════════════════════
// VIGILAR LA AUDITORÍA DE COMBUSTIBLE — corre solo, en la nube, y habla SOLO cuando algo cambia
//
// Máximo, 07/11/2026: *«que el cron no tenga que tener la computadora prendida»*.
//
// ⛔ QUÉ ES Y QUÉ NO ES. Esto no comprueba que el código haga lo que dice: mide si lo que dice
//    es CIERTO sobre los datos reales. Cada bloque contesta una pregunta que, contestada mal,
//    hace que el módulo MIENTA SIN FALLAR — devuelve un número con toda autoridad y está mal.
//    Es la mitad medible-sola de `scripts/auditar-la-auditoria-combustible.mjs`.
//
// ⚠️ LO QUE NO PUDO VENIR, Y POR QUÉ NO ES UNA FALTA. El medidor local tiene un bloque más: compara
//    la cubicación de la BASE (`tanque_veredicto`) contra la del NAVEGADOR (`_acCubicar` del
//    `app.js` desplegado), que son dos implementaciones de la misma fórmula. Eso necesita un
//    navegador cargando el app.js de verdad, y una edge function no lo puede hacer.
//    📌 Pero tampoco le servía un reloj: ese resultado solo cambia cuando cambia el CÓDIGO o la
//       TABLA, no cuando entran datos. Su disparador correcto es un cambio de código, no un cron.
//       Queda en `scripts/auditar-la-auditoria-combustible.mjs`, que se corre al tocar el módulo.
//
// ⚠️ Y VIVE ADENTRO DE LO QUE VIGILA. Un vigilante que muere junto con lo vigilado no es un
//    vigilante. Acá es aceptable a propósito: esto vigila la CALIDAD DEL DATO que hay dentro de
//    esta base, y si la base está caída nadie está cargando combustible tampoco. La
//    DISPONIBILIDAD la vigila el externo (`pc/vigilante-externo/`, GitHub Actions). Son dos
//    preguntas distintas y cada una necesita su vigilante en su lugar.
//
// HABLA SOLO CUANDO ALGO CAMBIA, pero NO SE CALLA PARA SIEMPRE: guarda la firma de lo medido en
// `configuracion.vig_comb_firma` y avisa si cambió. Y una vez por semana manda el estado aunque no
// haya cambiado nada — porque un canal caído se ve igual que todo en orden.
//
//   ?dry=1     → devuelve lo que diría, sin encolar y sin guardar la firma
//   ?forzar=1  → manda aunque no haya cambiado
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const forzar = url.searchParams.get('forzar') === '1';
  const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const desde = url.searchParams.get('desde') ||
    new Date(new Date(hoyVE + 'T12:00:00Z').getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const [tan, uCfg, med, ck, sur, gas, salT, emps, waCfg, cfgRC, cfgFirma] = await Promise.all([
    sb.from('combustible_tanques_config').select('id,nombre,tipo,forma,tabla_origen,altura_max_cm,tabla_cubicacion'),
    sb.from('unidad_config').select('cam,capacidad_tanque_l,mide_tanque'),
    sb.from('combustible_mediciones').select('vehiculo_id,fecha,momento,turno,tanque_id,altura_cm,litros_calculados').gte('fecha', desde),
    sb.from('checklist').select('fecha,cam,turno,km_salida,km_entrada').gte('fecha', desde),
    sb.from('surtidas').select('fecha,cam,turno,litros,tanque').gte('fecha', desde),
    sb.from('gasoil').select('f,tipo_operacion').eq('tipo_operacion', 'despacho'),
    sb.from('salidas_tanque').select('id'),
    sb.from('empleados').select('nombre,whatsapp,tel,activo,cargo'),
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'rol_cargos').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'vig_comb_firma').maybeSingle(),
  ]);
  if (tan.error) return json({ ok: false, error: tan.error.message }, 500);

  const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

  // Destinatarios: EXACTAMENTE la misma resolución que `auditar-combustible` (roster ∪ rol_cargos),
  // para que no haya dos listas de jefes que se desincronicen.
  let roster: any[] = []; try { roster = JSON.parse(String(waCfg.data?.valor || '[]')); } catch { roster = []; }
  let rolCargos: Record<string, any> = {};
  try { const c = cfgRC?.data?.valor; rolCargos = (typeof c === 'string' ? JSON.parse(c) : c) || {}; } catch { rolCargos = {}; }
  const telsPorCargos = (cargos: any[]): string[] => {
    const q = (cargos || []).map((c: any) => norm(c)).filter(Boolean);
    if (!q.length) return [];
    return (emps.data || []).filter((e: any) => e.activo !== false && q.includes(norm(e.cargo)))
      .map((e: any) => String(e.whatsapp || e.tel || '').replace(/\D/g, '')).filter(Boolean);
  };
  const telsRol = (roles: string[]): string[] => {
    const a = (Array.isArray(roster) ? roster : []).filter((w: any) => w.num && w.activo !== false && roles.includes(w.rol))
      .map((w: any) => String(w.num).replace(/\D/g, ''));
    const b = roles.flatMap((r) => {
      const d = rolCargos[r]; if (!d) return [];
      const t = (Array.isArray(d) ? d : (d.tels || [])).map((x: any) => String(x).replace(/\D/g, ''));
      return [...t, ...telsPorCargos(d.cargos || [])];
    });
    return [...new Set([...a, ...b])].filter(Boolean);
  };
  const destinatarios = telsRol(['mecanica', 'operativo', 'socios']);

  // ── LO QUE SE MIDE ────────────────────────────────────────────────────────────────────────────
  const hallazgos: { clave: string; grave: boolean; txt: string }[] = [];
  const puntos = (t: any): number[] => {
    let tb = t?.tabla_cubicacion;
    if (typeof tb === 'string') { try { tb = JSON.parse(tb); } catch { tb = null; } }
    return Object.keys(tb || {}).map(Number).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  };

  // 1 · Unidades que miden el tanque y no tienen de qué: sus centímetros no se vuelven litros nunca.
  const tanquesVeh = (tan.data || []).filter((t: any) => t.tipo === 'vehiculo');
  const marcadas = (uCfg.data || []).filter((u: any) => u.mide_tanque).map((u: any) => String(u.cam).trim());
  const sinTabla = (tan.data || []).filter((t: any) => puntos(t).length < 2).map((t: any) => t.id);
  if (marcadas.length && !tanquesVeh.length) {
    hallazgos.push({ clave: 'sin_tanques', grave: true,
      txt: `${marcadas.length} unidad(es) marcadas para medir el tanque y NINGÚN tanque de vehículo cubicado: esas mediciones en centímetros no se convierten en litros y el consumo de esas unidades no existe` });
  }
  if (sinTabla.length) {
    hallazgos.push({ clave: 'tabla_corta_' + sinTabla.join('_'), grave: true,
      txt: `tanque(s) sin tabla usable: ${sinTabla.join(', ')} — con menos de dos puntos no se puede interpolar nada` });
  }
  // La tabla DIVIDIDA no sirve para señalar a nadie: lo dice el propio esquema.
  const divididas = (tan.data || []).filter((t: any) => String(t.tabla_origen || '') === 'dividida').map((t: any) => t.id);
  if (divididas.length) {
    hallazgos.push({ clave: 'tabla_dividida_' + divididas.join('_'), grave: true,
      txt: `tanque(s) con tabla DIVIDIDA (capacidad ÷ altura): ${divididas.join(', ')}. Eso no es una medición y no aguanta señalar a nadie — hacen falta las medidas de cinta` });
  }

  // 2 · Lecturas fuera del rango de la tabla: se descartan, así que son consumo que no se calcula.
  const tqDe = (id: any) => (tan.data || []).find((t: any) => String(t.id) === String(id))
    || tanquesVeh[0] || (tan.data || [])[0];
  let fuera = 0;
  for (const m of (med.data || [])) {
    const t = tqDe(m.tanque_id); const h = Number(m.altura_cm);
    if (!t || !isFinite(h)) continue;
    const p = puntos(t); if (p.length < 2) continue;
    // +1 cm de gracia: la regla se lee en centímetros enteros (igual que `alturaOk` del auditor).
    if (h < p[0] - 1 || h > Number(t.altura_max_cm) + 1) fuera++;
  }
  if (fuera) hallazgos.push({ clave: 'fuera_de_tabla_' + fuera, grave: false,
    txt: `${fuera} lectura(s) de los últimos 30 días caen fuera del rango de su tabla: se descartan, así que ese día no tiene consumo calculado` });

  // 3 · Mediciones sin su checklist: sin km no hay rendimiento, y el rendimiento es media auditoría.
  const ckSet = new Set((ck.data || []).map((c: any) => [String(c.cam), String(c.fecha).slice(0, 10), String(c.turno || 'diurno')].join('|')));
  const jor = new Set((med.data || []).map((m: any) => [String(m.vehiculo_id), String(m.fecha).slice(0, 10), String(m.turno || 'diurno')].join('|')));
  const sinCk = [...jor].filter((k) => !ckSet.has(k)).length;
  if (sinCk) hallazgos.push({ clave: 'sin_checklist_' + sinCk, grave: false,
    txt: `${sinCk} jornada(s) con medición de tanque pero SIN checklist: no tienen km, así que no tienen rendimiento y no entran en ninguna comparación` });

  // 4 · Surtidas sin turno: no se le cargan a ninguna jornada ⇒ el consumo de ese día sale mal.
  const surSinTurno = (sur.data || []).filter((s: any) => !String(s.turno || '').trim()).length;
  if (surSinTurno) hallazgos.push({ clave: 'surtida_sin_turno_' + surSinTurno, grave: true,
    txt: `${surSinTurno} surtida(s) de los últimos 30 días sin turno declarado: no se le suman a ninguna jornada, y el consumo de ese día queda inflado` });

  // 5 · El circuito del combustible: ¿alguien mide de dónde SALE el gasoil, o solo dónde entra?
  const tanquesGalpon = (tan.data || []).filter((t: any) => t.tipo === 'galpon');
  const medGalpon = (med.data || []).filter((m: any) => tanquesGalpon.some((t: any) => String(t.id) === String(m.tanque_id))).length;
  const origenes: Record<string, number> = {};
  for (const s of (sur.data || [])) { const o = String(s.tanque || '').trim() || '(sin declarar)'; origenes[o] = (origenes[o] || 0) + 1; }
  const delGalpon = Object.keys(origenes).filter((o) => /galpon/i.test(o)).reduce((a, k) => a + origenes[k], 0);
  if (tanquesGalpon.length && medGalpon === 0 && delGalpon > 0) {
    hallazgos.push({ clave: 'galpon_sin_medir', grave: true,
      txt: `${delGalpon} surtida(s) dicen venir del galpón y los ${tanquesGalpon.length} tanque(s) del galpón NUNCA se midieron con la regla: el litro que sale no se mide en el origen, así que ningún faltante se puede sostener` });
  }
  if ((salT.data || []).length === 0 && tanquesGalpon.length) {
    hallazgos.push({ clave: 'sin_salidas_tanque', grave: false,
      txt: `cero filas en salidas_tanque: el gasoil que sale del galpón y NO va a un camión no se registra en ninguna parte` });
  }

  // 6 · El propio aviso de la mañana: si no tiene a quién preguntarle, no existe.
  if (!destinatarios.length) {
    hallazgos.push({ clave: 'sin_destinatarios', grave: true,
      txt: 'no hay NINGÚN destinatario para los avisos de combustible (ni roster ni rol_cargos): el módulo calcula y no le habla a nadie' });
  }

  // ── ¿CAMBIÓ ALGO? ─────────────────────────────────────────────────────────────────────────────
  const firma = hallazgos.map((h) => h.clave).sort().join('|') || 'limpio';
  let previa = ''; let ultimoAviso = '';
  try {
    const v = cfgFirma?.data?.valor;
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    previa = String(o?.firma || ''); ultimoAviso = String(o?.ultimo_aviso || '');
  } catch { previa = ''; }
  const cambio = firma !== previa;
  // El latido semanal: sin esto, «no dijo nada» y «el canal está roto» se leen igual.
  const diasDesde = ultimoAviso ? Math.floor((Date.parse(hoyVE) - Date.parse(ultimoAviso)) / 86400000) : 999;
  const latido = diasDesde >= 7;
  const habla = forzar || cambio || latido;

  const motivo = forzar ? 'forzado' : cambio ? 'cambió algo' : latido ? `latido semanal (${diasDesde} días sin avisar)` : 'sin cambios';
  const graves = hallazgos.filter((h) => h.grave);

  let msg = '';
  if (habla) {
    msg = `🔍 Revisión del módulo de combustible — ${hoyVE.split('-').reverse().join('/')}\n\n`;
    if (!hallazgos.length) {
      msg += `✅ Todo en orden: los tanques tienen tabla usable, las lecturas caen en rango, las jornadas tienen checklist y las surtidas tienen turno.\n\nEste mensaje sale una vez por semana aunque no haya nada, para que se sepa que la revisión está corriendo.`;
    } else {
      if (graves.length) msg += `🔴 Lo que impide cuadrar el combustible (${graves.length}):\n` + graves.map((h) => `• ${h.txt}`).join('\n') + '\n';
      const leves = hallazgos.filter((h) => !h.grave);
      if (leves.length) msg += `\n🟠 Lo que deja días sin consumo calculado (${leves.length}):\n` + leves.map((h) => `• ${h.txt}`).join('\n') + '\n';
      msg += `\n${cambio ? 'Esto cambió desde la última revisión.' : 'Sin cambios desde la última revisión: va el estado para que se sepa que sigue corriendo.'}`;
      msg += `\n\nNo es un reclamo a nadie: son datos que faltan o que no se pueden usar. El detalle está en Combustible → Auditoría.`;
    }
  }

  const resumen = { ok: true, dry, desde, firma, firma_previa: previa || null, cambio, latido, motivo,
                    hallazgos, destinatarios: destinatarios.length };
  if (dry) return json({ ...resumen, mensaje: msg || null });
  if (!habla) return json({ ...resumen, avisos: 0 });
  // ⛔ Sin destinatarios NO se guarda la firma: si se guardara, el día que alguien configure los
  //    teléfonos ya no habría «cambio» y el primer aviso no saldría nunca. Es el mismo error que
  //    quemó 65 días de `comb_jefes_*` en Flotilla.
  if (!destinatarios.length) {
    return json({ ...resumen, avisos: 0, nota: 'había algo que decir y ningún destinatario: la firma NO se guarda, así que se recupera cuando se configure' });
  }
  const ins = await sb.from('cola_mensajes').insert(destinatarios.map((t) => ({ telefono: t, mensaje: msg, tipo: 'auditoria' })));
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  const up = await sb.from('configuracion').upsert(
    { clave: 'vig_comb_firma', valor: JSON.stringify({ firma, ultimo_aviso: hoyVE }) }, { onConflict: 'clave' });
  if (up.error) console.log('[vigilante] no se pudo guardar la firma:', up.error.message);
  return json({ ...resumen, avisos: destinatarios.length });
});
