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
// empresa. Fecha en America/Caracas.
//   ?dry=1     → devuelve lo que mandaría, sin encolar, sin marcar y sin escribir en sombra.
//   ?sombra=1  → SOLO guarda los hallazgos en sombra, sin encolar ni un mensaje (para rellenar
//                días pasados sin que salga un WhatsApp viejo).
//   ?fecha=    → revisa otro día (por defecto, ayer).
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

// ── EL PORTÓN: cuándo tiene derecho este cron a insinuar una sustracción ───────────────────────
// El 2026-07-24 se descubrió que venía acusando en falso por WhatsApp, con nombre y apellido: de 26
// casos de julio, 12 eran camiones que SÍ habían rodado (hasta 208 km) porque la regla afirmaba
// "un camión estacionado no consume" sin haber mirado nunca el odómetro.
//
// Eso ya está corregido. Pero el permiso para volver a hablar NO es una constante que alguien
// cambia a mano cuando se siente listo — así fue como se llegó al problema. Es un portón que el
// propio sistema controla, y que exige LAS TRES cosas a la vez:
//
//   1. LA TABLA DESCRIBE AL TANQUE. Se comprueba solo, contra la FORMA declarada del tanque: en un
//      cajón la tabla correcta es una recta, en un cuerpo con panza tiene que tener curva, y una
//      tabla que salió de medir el tanque vale por sí sola. (Antes esto solo miraba si había curva,
//      y así un tanque de cajón legítimo habría quedado mudo para siempre.)
//      El JAC se midió el 25/07: 60 × 52,5 × 199 cm, esquinas r=12,54 → 600 L. Antes tenía
//      13,043 L/cm parejo, que era 600 ÷ 46: una división, no una medición.
//   2. EXAMEN APROBADO en modo sombra: veredictos humanos guardados en `comb_auditoria_sombra`,
//      con al menos MIN_EVAL casos evaluados, PRECISION_MIN de acierto y ninguna falsa reciente.
//   3. INTERRUPTOR EN ON: `configuracion.aud_comb_avisar` = 'on'. Es la decisión de Máximo, pero
//      solo puede tomarla cuando 1 y 2 ya se cumplen (la pantalla ni siquiera ofrece el botón).
//
// Y KILL-SWITCH: si estando encendido aparecen 2 veredictos 'falsa' seguidos, el cron se apaga
// SOLO (escribe 'off' en la configuración) y avisa a socios por qué. La confianza cuesta ganarla y
// se pierde con una sola acusación injusta: el sistema tiene que saber callarse sin que se lo pidan.
const MIN_EVAL = 15;         // casos con veredicto humano antes de poder opinar
const PRECISION_MIN = 0.90;  // 9 de cada 10 tienen que haber sido de verdad
const DIAS_SIN_FALSAS = 14;  // y ninguna falsa en las últimas 2 semanas

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  // ?sombra=1 → SOLO guarda los hallazgos en `comb_auditoria_sombra` y no encola ni un mensaje.
  // Sirve para rellenar días ya pasados sin ningún riesgo de que salga un WhatsApp viejo (norma:
  // lo de ayer no se envía hoy).
  const soloSombra = url.searchParams.get('sombra') === '1';
  // Por defecto revisa AYER (el día ya cerrado). ?fecha=YYYY-MM-DD para revisar otro.
  const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const fecha = url.searchParams.get('fecha') || new Date(new Date(hoyVE + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const previo = new Date(new Date(fecha + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

  const [cfgT, med, gas, ck, emps, waCfg, logs, sur, cfgCorte, cfgAvisar, somb, uCfg] = await Promise.all([
    sb.from('combustible_tanques_config').select('*'),
    sb.from('combustible_mediciones').select('*').gte('fecha', previo).lte('fecha', fecha),
    sb.from('gasoil').select('*').gte('f', previo).lte('f', fecha),
    sb.from('checklist').select('fecha,cam,conductor,km_salida,km_entrada').gte('fecha', previo).lte('fecha', fecha),
    sb.from('empleados').select('nombre,whatsapp,tel,activo,cargo'),
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('alertas_log').select('alert_key').like('alert_key', 'comb_%'),
    sb.from('surtidas').select('*').gte('fecha', previo).lte('fecha', fecha),
    sb.from('configuracion').select('valor').eq('clave', 'surtidas_corte').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'aud_comb_avisar').maybeSingle(),
    sb.from('comb_auditoria_sombra').select('veredicto,fecha,veredicto_at').order('veredicto_at', { ascending: false }).limit(300),
    sb.from('unidad_config').select('cam,capacidad_tanque_l'),
  ]);
  if (cfgT.error) return json({ ok: false, error: cfgT.error.message }, 500);
  const corteSur = String(cfgCorte?.data?.valor || '').replace(/"/g, '').slice(0, 10);

  const tanques = (cfgT.data || []).map((t: any) => {
    let tabla = t.tabla_cubicacion;
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla); } catch { tabla = null; } }
    return { id: t.id, tipo: t.tipo, hmax: num(t.altura_max_cm), tabla, forma: t.forma ?? null, tabla_origen: t.tabla_origen ?? null, tabla_desde: t.tabla_desde ?? null };
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

  // ── EL PORTÓN: las tres condiciones se evalúan acá, no en la cabeza de nadie ────────────────
  // 1. ¿La tabla de cubicación DESCRIBE al tanque, o es una división disfrazada?
  //    Antes esto miraba una sola cosa: si la tabla tenía curva. Estaba mal pensado — en un tanque
  //    de cajón la tabla correcta ES una recta, y con esa regla habría quedado mudo para siempre
  //    aunque sus números fueran perfectos. Lo que hace falta es saber QUÉ FORMA tiene el tanque.
  //    ⚠️ La MISMA comprobación está en app.js (_acTablaDescribeTanque): se cambian las dos juntas.
  const tablaDescribeTanque = (tq: any): boolean => {
    if (!tq || !tq.tabla) return false;
    // Salió de tocar el tanque: aforo con volúmenes conocidos, o geometría sobre medidas reales.
    if (tq.tabla_origen === 'medida' || tq.tabla_origen === 'calculada_de_medidas') return true;
    const ps = puntos(tq); if (ps.length < 4) return false;
    const inc: number[] = [];
    for (let i = 1; i < ps.length; i++) {
      const a = num(tq.tabla[String(ps[i - 1])]), b = num(tq.tabla[String(ps[i])]);
      if (a == null || b == null) return false;
      inc.push((b - a) / (ps[i] - ps[i - 1]));
    }
    const mx = Math.max(...inc), mn = Math.min(...inc);
    if (!(mx > 0)) return false;
    const esRecta = (mx - mn) <= mx * 0.05;
    if (tq.forma === 'rectangular') return esRecta;
    if (tq.forma === 'cilindro_horizontal' || tq.forma === 'rectangular_redondeado' || tq.forma === 'irregular') return !esRecta;
    return false;   // forma sin declarar: no se afirma lo que no se sabe
  };
  const aforoOk = tablaDescribeTanque(tanques.find((x) => x.tipo === 'vehiculo') || tanques[0]);

  // 2. ¿Pasó el examen del modo sombra? Solo cuentan los veredictos humanos ya dados.
  const vered = (somb.data || []).filter((x: any) => x.veredicto === 'verdadera' || x.veredicto === 'falsa');
  const okN = vered.filter((x: any) => x.veredicto === 'verdadera').length;
  const prec = vered.length ? okN / vered.length : 0;
  const limFalsas = new Date(new Date(fecha + 'T12:00:00Z').getTime() - DIAS_SIN_FALSAS * 86400000).toISOString().slice(0, 10);
  const falsasRecientes = vered.filter((x: any) => x.veredicto === 'falsa' && String(x.fecha).slice(0, 10) >= limFalsas).length;
  const examenOk = vered.length >= MIN_EVAL && prec >= PRECISION_MIN && falsasRecientes === 0;

  // 3. ¿El interruptor está en on? Es la decisión de Máximo — pero solo puede tomarla cuando 1 y 2
  //    ya se cumplen (la pantalla ni siquiera le ofrece el botón antes).
  const interruptor = String(cfgAvisar?.data?.valor || '').replace(/"/g, '').toLowerCase() === 'on';

  // KILL-SWITCH: los dos veredictos más recientes fueron 'falsa' → el cron se calla solo.
  const ultimos2 = vered.slice(0, 2);
  const dosFalsas = ultimos2.length === 2 && ultimos2.every((x: any) => x.veredicto === 'falsa');

  const AVISAR_SUSTRACCION = aforoOk && examenOk && interruptor && !dosFalsas;

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
  const noConfiables = new Set<string>();
  let dupIguales = 0;
  // Por unidad Y POR MOMENTO. Antes era un solo contador por unidad y el texto sumaba salida con
  // llegada: JAC-B010 el 30/07 tenía 3 filas de salida y 2 de llegada, y el WhatsApp decía "cargada
  // 4 veces" — un número que no existió nunca. Un conteo que suma peras con manzanas no se le manda
  // a nadie. (2026-07-31)
  const dupPorUnidad: Record<string, Record<string, number>> = {};
  Object.keys(porMomento).forEach((k) => {
    const lista = porMomento[k];
    const alturas = new Set(lista.map((m: any) => String(num(m.altura_cm))));
    dupIguales += (lista.length - alturas.size);
    // Corregida = dos alturas distintas (histórico) O la marca de la BASE (columna `corregida`,
    // trigger 2026-07-31). Con el upsert del chofer la fila vieja ya no queda: sin esa marca
    // ningún día volvería a contar como corregido y las reglas de faltante opinarían sobre días
    // en los que la lectura se contradijo. Gemelo de `_acDedupe` en app.js: se cambian juntos.
    if (alturas.size > 1 || lista[lista.length - 1]?.corregida === true) corregidas.add(k);
    // TERCER ESTADO (2026-08-19): alguien declaró que el dato es FALSO y que ya no se puede
    // averiguar el verdadero. Entra al MISMO conjunto porque las reglas tienen que callarse igual
    // —no se le puede reclamar un faltante a un día cuya lectura sabemos inventada—, pero se
    // cuenta aparte para poder decirlo en el resumen: si el día simplemente desaparece de los
    // números sin explicación, el que lee el informe ve menos litros y no sabe por qué.
    // Gemelo de `_acDedupe` en app.js: se cambian juntos.
    if (lista[lista.length - 1]?.no_confiable === true) { corregidas.add(k); noConfiables.add(k); }
    if (lista.length > 1 && String(lista[0].fecha).slice(0, 10) === fecha) {
      const v = String(lista[0].vehiculo_id), mo = String(lista[0].momento || '?');
      (dupPorUnidad[v] = dupPorUnidad[v] || {})[mo] = lista.length;
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

  // ── LO QUE ENTRA AL CAMIÓN — FUENTE ÚNICA CON FREEZE FECHADO ──
  // Desde `configuracion.surtidas_corte` la verdad es `surtidas`: la carga la asienta quien surte,
  // en el momento, con foto y GPS, venga del galpón o de la estación. Antes de esa fecha vale el
  // histórico congelado de `gasoil`, que se tipeaba a mano días después (y murió el 07/07/2026).
  // Nunca las dos fuentes para la misma fecha: sería contar el mismo litro dos veces.
  // Hasta el 2026-07-24 esto leía SOLO `gasoil`, o sea que después del corte no veía entrar nada —
  // por eso decía "sin despacho que lo explique" cuando en realidad no miraba donde debía.
  // Las surtidas traen hora: con `tsA`/`tsB` (los created_at de las dos lecturas de regla) se sabe
  // si la carga fue antes o después de pasar la regla. Con solo la fecha, una carga de las 11 de la
  // mañana se contaría como entrada de la noche y el patio daría un faltante que nunca existió.
  // Capacidad del tanque de CADA unidad. Es la misma fuente que ya usa `surtida_registrar` para su
  // tope por dedazo, a propósito: si mañana se corrige la capacidad de un camión, se corrige en un
  // solo lugar y los dos controles se enteran juntos [[norma-fuente-unica-datos]].
  const capsUnidad = new Map<string, number>();
  (uCfg.data || []).forEach((r: any) => {
    const c = num(r.capacidad_tanque_l);
    if (c != null && c > 0) capsUnidad.set(String(r.cam), c);
  });
  const capacidadDe = (u: string) => capsUnidad.get(u) ?? null;

  const entradas = (u: string, fA: string, fB: string, incluirFA: boolean, tsA?: string, tsB?: string) => {
    const dentro = (f: string) => (incluirFA ? f >= fA : f > fA) && f <= fB;
    let suma = 0;
    (sur.data || []).forEach((s: any) => {
      if (String(s.cam) !== u) return;
      const f = String(s.fecha || '').slice(0, 10);
      if (corteSur && f < corteSur) return;              // antes del corte manda gasoil
      const tsS = String(s.created_at || '');   // 'ts' es ahora el helper de fechas: no hacerle sombra
      if (tsA && tsB && tsS) { if (!(tsS > tsA && tsS <= tsB)) return; }
      else if (!dentro(f)) return;
      suma += (num(s.litros) || 0);
    });
    (gas.data || []).forEach((gg: any) => {
      if (String(gg.cam) !== u) return;
      if (String(gg.tipo_operacion || '') === 'compra') return;   // compra = entra al galpón
      const f = String(gg.f || '').slice(0, 10);
      if (corteSur && f >= corteSur) return;             // desde el corte manda surtidas
      if (!dentro(f)) return;
      suma += (num(gg.lit) || 0);
    });
    return Math.round(suma * 100) / 100;
  };
  // Litros que entraron en la ventana PERO cuya fila NO tiene hora: el histórico `gasoil`, que rrhh1
  // tipeaba en lote días después (el 07/07 se le cargaron 80+120 L a toda la flota, asentados el
  // 08/07). De una fila así no se puede saber si el combustible entró antes o después de la lectura
  // de la noche, y sin eso el cuadre del patio no significa nada: R1 la usa para CALLARSE, no para
  // restar. Sin este freno los 8 camiones del 07/07 salían acusados de "faltan 200 L" cuando lo que
  // pasó es que cargaron en la bomba durante el día.
  const entradasSinHora = (u: string, fA: string, fB: string, incluirFA: boolean) => {
    const dentro = (f: string) => (incluirFA ? f >= fA : f > fA) && f <= fB;
    let suma = 0;
    (gas.data || []).forEach((gg: any) => {
      if (String(gg.cam) !== u) return;
      if (String(gg.tipo_operacion || '') === 'compra') return;
      const f = String(gg.f || '').slice(0, 10);
      if (corteSur && f >= corteSur) return;
      if (!dentro(f)) return;
      suma += (num(gg.lit) || 0);
    });
    (sur.data || []).forEach((s: any) => {          // una surtida sin created_at tampoco se ubica
      if (String(s.cam) !== u) return;
      if (String(s.created_at || '')) return;
      const f = String(s.fecha || '').slice(0, 10);
      if (corteSur && f < corteSur) return;
      if (!dentro(f)) return;
      suma += (num(s.litros) || 0);
    });
    return Math.round(suma * 100) / 100;
  };

  for (const u of unidades.concat(ckDia.map((c: any) => String(c.cam)).filter((x) => !unidades.includes(x)))) {
    const ms = delDia.filter((m: any) => String(m.vehiculo_id) === u);
    const sal = ms.find((m: any) => String(m.momento) === 'salida');
    const lle = ms.find((m: any) => String(m.momento) === 'llegada');
    const c = ckDia.find((x: any) => String(x.cam) === u);
    const chofer = String(c?.conductor || sal?.registrado_por || lle?.registrado_por || '').trim();
    const kmS = km(c?.km_salida), kmE = km(c?.km_entrada);
    const trabajo = kmS != null && kmE != null && kmE > kmS;

    // ⛔ EL DUPLICADO NO ES CULPA DEL CHOFER Y ÉL NO PUEDE ARREGLARLO (2026-07-31).
    // Iba en `errores`, o sea que se le mandaba por WhatsApp "tu medición quedó cargada N veces"
    // todos los días. Pero él no puede borrar una fila, y sobre todo: las filas repetidas las hacía
    // la app (insert sin upsert + dos pasadas simultáneas de la cola; JAC-B002 llegó a meter tres
    // filas en 211 milésimas de segundo). Se arregló en la base con un UNIQUE y en la PWA con
    // upsert. Esto queda como HALLAZGO para los jefes: si vuelve a aparecer, es la app otra vez.
    if (dupPorUnidad[u]) {
      const det = Object.keys(dupPorUnidad[u]).map((mo) => `${dupPorUnidad[u][mo]} de ${mo}`).join(' y ');
      hallazgos.push({ u, tipo: 'R14', txt: `quedaron ${det} — la misma medición cargada más de una vez. Se usa la última; no hay que reclamarle nada al chofer, es la app repitiendo el envío.` });
    }
    // ── R15 · LA SURTIDA NO CABE EN EL TANQUE ───────────────────────────────────────────────────
    // Pedido de Máximo (2026-08-18) después del caso de Samuel: "¿hay un motor que haga esa misma
    // evaluación con cada surtida?". La evaluación que él hizo a mano fue litros surtidos contra el
    // ESPACIO LIBRE del tanque, que es distinto del tope que ya existe en `surtida_registrar`
    // (capacidad × 1,5): ese atrapa el dedazo, no el imposible físico.
    //
    // ⛔ POR QUÉ AVISA Y NO TRANCA. Se midió contra los 57 registros que tienen medición de salida:
    //    un candado duro sobre "litros > espacio libre" habría rechazado 25 — el 44 % del trabajo
    //    legítimo. La razón es física y no se puede evitar: el nivel se mide AL SALIR y la surtida
    //    ocurre horas después, con el camión ya habiendo quemado gasoil. El espacio libre al salir
    //    es un PISO, no el valor del momento. Trancar sobre un piso es trancar sobre un dato viejo.
    //
    // ⚠️ LA GRACIA SALE DE LOS DATOS, no de un número redondo: con el corte en un cuarto de tanque
    //    (150 L en el JAC) quedan 32 "cabe" + 23 explicadas por el consumo del día, y aparecen
    //    exactamente 2 casos reales. No es un umbral elegido para que dé lindo: por debajo de eso
    //    el ruido se come la señal.
    //
    // ⛔ Y VA COMO HALLAZGO, NO COMO ERROR DEL CHOFER, porque en uno de los 2 casos que encuentra
    //    —JAC-B006 del 15/08— el número malo es la MEDICIÓN (los 175 cm que dieron 596 L), no la
    //    carga. Mandarle al chofer "tu surtida no cabe" cuando el que se equivocó midiendo fue otro
    //    es acusar al que no fue. Se dicen los dos números y que decida una persona.
    if (sal) {
      const capU = capacidadDe(u);
      const nivelSal = cubicar(tqDe(sal), sal.altura_cm);
      if (capU != null && capU > 0 && nivelSal != null && alturaOk(tqDe(sal), sal.altura_cm)) {
        const libre = capU - nivelSal;
        const gracia = capU * 0.25;
        (sur.data || [])
          .filter((s: any) => String(s.cam) === u && String(s.fecha).slice(0, 10) === fecha)
          .forEach((s: any) => {
            const l = num(s.litros);
            if (l == null || l <= libre + gracia) return;
            hallazgos.push({ u, tipo: 'R15',
              txt: `se cargaron ${fmt(l)} L pero al salir el tanque marcaba ${fmt(nivelSal)} L de ${fmt(capU)} L: solo quedaban ${fmt(libre)} L libres. Uno de los dos números está mal —la medición o la carga—; hay que preguntar cuál, no dar por buena ninguna.` });
          });
      }
    }

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
      // Los litros guardados solo se le reclaman a alguien si se guardaron con ESTA tabla. Al
      // corregir la cubicación del JAC el 25/07 todas las mediciones viejas quedaron sin cuadrar
      // contra la tabla nueva: se habían guardado con la recta que regía ese día. Sin este candado,
      // el cron de las 7am le mandaba un WhatsApp a cada chofer por un dato que cargó bien (probado:
      // 25 reclamos en una flota de 12 camiones). Arreglar la tabla no puede hacer culpable a nadie.
      const conTablaVieja = antesDe(m.created_at, tq?.tabla_desde);
      const calc = cubicar(tq, cm);
      if (!conTablaVieja && calc != null && rec != null && Math.abs(rec - calc) > 2) {
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
      const desp = entradas(u, previo, fecha, false, String(lleAyer.created_at || ''), String(sal.created_at || ''));
      // Si alguna carga de esa ventana no tiene hora, no se puede ubicar en el tiempo: R1 se calla.
      // El agujero de registro lo reporta R9, que no acusa a nadie.
      if (entradasSinHora(u, previo, fecha, false) > 0) continue;
      if (a != null && b != null) {
        const d = Math.round((a - b - desp) * 100) / 100;
        const t1 = tol(tqDe(sal), lleAyer.altura_cm, sal.altura_cm, desp);
        // Sin nombre de chofer: de noche el custodio es el PATIO, no la persona que manejó.
        if (d < -2 * t1) graves.push({ u, litros: d, tol: t1, txt: `quedó el ${fmtFecha(previo)} con ${fmt(b)} L y amaneció con ${fmt(a)} L: faltan ${fmt(Math.abs(d))} L, con el odómetro igual y ${desp > 0 ? `con la carga de esa noche (${fmt(desp)} L, con hora) ya descontada` : 'sin carga registrada'} (el error de la regla explica hasta ±${fmt(t1)} L)` });
        else if (d > 2 * t1) entraron.push({ u, litros: d });
      }
    }

    // Llegó con MÁS de lo que salió: cargó durante el día y no quedó asentado.
    if (sal && lle && alturaOk(tqDe(sal), sal.altura_cm) && alturaOk(tqDe(lle), lle.altura_cm)
        && !corregidas.has([u, fecha, 'salida'].join('|')) && !corregidas.has([u, fecha, 'llegada'].join('|'))) {
      const s2 = cubicar(tqDe(sal), sal.altura_cm), l2 = cubicar(tqDe(lle), lle.altura_cm);
      const desp2 = entradas(u, fecha, fecha, true, String(sal.created_at || ''), String(lle.created_at || ''));
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

  // ── MODO SOMBRA: el hallazgo se guarda SIEMPRE, se avise o no ──────────────────────────────
  // Este es el dataset que mide al auditor. Mientras AVISAR_SUSTRACCION esté en false no sale ni
  // un WhatsApp, pero cada faltante queda anotado con veredicto 'pendiente' para que una persona
  // lo marque verdadera o falsa. Sin ese veredicto humano guardado no hay forma objetiva de saber
  // si el módulo ya se ganó el derecho a volver a hablar — se decidiría por fe, que es como se
  // llegó al problema. Idempotente por `alert_key`: el cron puede reprocesar sin duplicar.
  if (!dry && graves.length) {
    const sombra = graves.map((x: any) => ({
      alert_key: `sombra_R1_${x.u}_${fecha}`,
      fecha, regla: 'R1', cam: x.u,
      litros: x.litros, tolerancia: x.tol,
      detalle: `${x.u} ${x.txt}`,
    }));
    const up = await sb.from('comb_auditoria_sombra')
      .upsert(sombra, { onConflict: 'alert_key', ignoreDuplicates: true });
    if (up.error) return json({ ok: false, error: 'sombra: ' + up.error.message }, 500);
  }
  if (soloSombra) return json({ ok: true, soloSombra: true, fecha, graves: graves.length, nota: 'guardado en sombra, sin encolar ningún mensaje' });

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

  // ── KILL-SWITCH EN ACCIÓN ────────────────────────────────────────────────────────────────────
  // Estaba encendido y los dos últimos casos revisados resultaron falsa alarma: se apaga solo y lo
  // dice. No espera a que alguien se dé cuenta ni a que alguien se anime a apagarlo. Una acusación
  // injusta cuesta más que diez avisos que no salieron.
  if (!dry && interruptor && dosFalsas) {
    const off = await sb.from('configuracion').upsert({ clave: 'aud_comb_avisar', valor: 'off' }, { onConflict: 'clave' });
    if (off.error) console.log('[killswitch] no se pudo apagar:', off.error.message);
    const kkey = `comb_killswitch_${fecha}`;
    if (!yaEnviado.has(kkey)) {
      const aviso = `🔇 Se apagó solo el aviso de faltantes de combustible.\n\n` +
        `Los dos últimos casos que se revisaron resultaron ser falsa alarma, así que el sistema dejó de avisar por WhatsApp: ` +
        `no puede seguir señalando con números que no aguantan.\n\n` +
        `Se sigue calculando y guardando todo en Combustible → Auditoría → Modo sombra. Cuando se corrija lo que esté fallando ` +
        `y vuelva a pasar el examen, se enciende de nuevo desde ahí.`;
      telsRol(['socios']).forEach((t) => filas.push({ telefono: t, mensaje: aviso, tipo: 'auditoria' }));
      marcar.push(kkey);
    }
  }

  // ── Resumen a los JEFES ──
  const keyJefes = `comb_jefes_${fecha}`;
  const gravesAvisables = AVISAR_SUSTRACCION ? graves : [];
  if (!yaEnviado.has(keyJefes) && (errores.length || hallazgos.length || gravesAvisables.length)) {
    let msg = `🔎 Revisión del combustible — ${fmtFecha(fecha)}\n`;
    if (gravesAvisables.length) {
      msg += `\n🔴 PARA REVISAR (${gravesAvisables.length}):\n` + gravesAvisables.map((x) => `• ${x.u}: ${x.txt}`).join('\n') + '\n';
    }
    // R15 va aparte: no es "falta un registro", es "hay dos números y no pueden ser los dos ciertos".
    // Mezclarlo con los huecos de registro lo haría leer como papeleo pendiente, y lo que pide es
    // que alguien pregunte hoy —mientras el chofer se acuerda de lo que cargó.
    const noCabe = hallazgos.filter((x) => x.tipo === 'R15');
    const resto = hallazgos.filter((x) => x.tipo !== 'R15');
    if (noCabe.length) {
      msg += `\n⚠️ La carga no cabe en el tanque (${noCabe.length}):\n` + noCabe.map((x) => `• ${x.u}: ${x.txt}`).join('\n') + '\n';
    }
    if (resto.length) {
      msg += `\n🟠 Registro que falta o quedó repetido (${resto.length}):\n` + resto.map((x) => `• ${x.u ? x.u + ': ' : ''}${x.txt}`).join('\n') + '\n';
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
      msg += `\n\nℹ️ Quedaron ${graves.length} caso(s) de combustible sin cuadrar, guardados para revisar. No se detallan acá ni se le atribuyen a nadie: la medición del tanque se está recalibrando. Están en Combustible → Auditoría → Modo sombra.`;
    }
    msg += `\n\nEl detalle completo está en Combustible → Auditoría.`;
    jefes.forEach((t) => filas.push({ telefono: t, mensaje: msg, tipo: 'auditoria' }));
    marcar.push(keyJefes);
  }

  const resumen = { fecha, corte: corteSur || null, duplicados: dupIguales, corregidas: corregidas.size,
    // Se dice aparte: son días que salen de los números porque el dato es falso, no porque falte.
    no_confiables: noConfiables.size,
    errores: errores.length, hallazgos: hallazgos.length, graves: graves.length,
    // El estado del portón sale siempre en la respuesta: si alguien se pregunta por qué no avisó,
    // acá está la razón exacta, sin tener que leer el código.
    porton: { avisa: AVISAR_SUSTRACCION, aforoOk, examenOk, interruptor, dosFalsas, evaluados: vered.length, precision: Math.round(prec * 100) } };
  // ⚠️ El seco devolvía SOLO conteos ("hallazgos: 2"), y con eso no se puede comprobar nada: hay que
  //    creerle al número. El modo existe justamente para ver qué DIRÍA antes de que lo diga, así que
  //    devuelve también el detalle. Sin esto, verificar un control nuevo obliga a mandarlo de verdad.
  if (dry) return json({ ok: true, dry: true, ...resumen, encolaria: filas.length, muestra: filas.slice(-2),
    detalle: { errores, hallazgos, graves } });
  if (!filas.length) return json({ ok: true, ...resumen, avisos: 0, nota: 'nada que avisar' });

  const ins = await sb.from('cola_mensajes').insert(filas);
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  if (marcar.length) await sb.from('alertas_log').insert([...new Set(marcar)].map((k) => ({ alert_key: k })));
  return json({ ok: true, ...resumen, avisos: filas.length });
});

function num(v: any): number | null { const n = parseFloat(v); return isFinite(n) ? n : null; }
// Sello de tiempo de Postgres ➜ milisegundos. Hay que normalizarlo a mano: Postgres devuelve
// "2026-07-09 12:34:56.789+00" (espacio y offset de DOS dígitos) y `Date.parse` de eso da NaN — el
// offset ISO válido es "+00:00" o "Z". Costó un bug: el candado de R8 daba false para TODAS las
// mediciones viejas, que es exactamente lo contrario de lo que tiene que hacer.
function ts(v: any): number | null {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')   // +0000 ➜ +00:00
    .replace(/([+-]\d{2})$/, '$1:00');         // +00   ➜ +00:00
  const t = Date.parse(s);
  return isFinite(t) ? t : null;
}
// ¿`ts` es anterior a `corte`? Como FECHAS, nunca como texto.
function antesDe(a: any, corte: any): boolean {
  const x = ts(a), y = ts(corte);
  return (x != null && y != null && x < y);
}
function fmt(n: any): string { return (n == null) ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }); }
function fmtFecha(f: string): string { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
function primerNombre(n: string): string {
  const t = String(n || '').trim().split(/[ ,]+/)[0] || '';
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
}
function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
