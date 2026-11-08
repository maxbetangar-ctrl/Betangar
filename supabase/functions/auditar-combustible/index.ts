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
  // ?manana=1 → SOLO la pregunta de la mañana siguiente (R14), y sobre HOY, no sobre ayer.
  //
  // ⛔ POR QUÉ NECESITA SU PROPIO MODO. Todo lo demás audita el día YA CERRADO —ayer— porque
  //    necesita la salida y la llegada del mismo día. R14 no: le alcanzan la llegada de ANOCHE y la
  //    salida de ESTA MAÑANA, y las dos existen a las 7 am. Corriendo con el `fecha` de siempre, la
  //    pregunta salía sobre la noche de ANTEAYER y el mensaje decía "anoche": un día tarde, que es
  //    justo lo que esta pieza venía a arreglar — se pregunta mientras la gente se acuerda.
  //
  // 📌 Y no es una copia de la regla: es la MISMA vuelta del bucle (el bloque R1, que compara la
  //    llegada de `previo` con la salida de `fecha`) corrida con fecha=hoy. Lo único que hace el
  //    modo es no emitir el resto, porque sobre un día abierto el resto todavía no sabe nada.
  const soloNoche = url.searchParams.get('manana') === '1';
  // Por defecto revisa AYER (el día ya cerrado). ?fecha=YYYY-MM-DD para revisar otro.
  const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const fecha = url.searchParams.get('fecha') || (soloNoche ? hoyVE
                : new Date(new Date(hoyVE + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10));
  const previo = new Date(new Date(fecha + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  // ⛔ EL TRAMO DE PATIO PUEDE TENER UN FIN DE SEMANA ADENTRO. Hasta el 07/11/2026 esta funcion
  //    cargaba SOLO `previo..fecha` (dos dias), asi que un camion que llegaba el viernes y salia
  //    el lunes no se auditaba NUNCA: no habia llegada en `previo`. La pantalla si lo miraba, y
  //    por eso las gemelas se separaban — lo encontro `pruebas/gemelas-dicen-lo-mismo.mjs`.
  //    4 dias cubre el fin de semana largo. GEMELO de `AC_NOCHE_DIAS_MAX` en `app.js`.
  const NOCHE_DIAS_MAX = 4;
  const desdeVent = new Date(new Date(fecha + 'T12:00:00Z').getTime() - NOCHE_DIAS_MAX * 86400000).toISOString().slice(0, 10);

  const [cfgT, med, gas, ck, emps, waCfg, logs, sur, cfgCorte, cfgAvisar, cfgDuda, somb, uCfg, cfgManana, cfgRolCargos, cfgRendRef] = await Promise.all([
    sb.from('combustible_tanques_config').select('*'),
    sb.from('combustible_mediciones').select('*').gte('fecha', desdeVent).lte('fecha', fecha),
    sb.from('gasoil').select('*').gte('f', desdeVent).lte('f', fecha),
    sb.from('checklist').select('fecha,cam,conductor,km_salida,km_entrada').gte('fecha', desdeVent).lte('fecha', fecha),
    sb.from('empleados').select('nombre,whatsapp,tel,activo,cargo'),
    sb.from('configuracion').select('valor').eq('clave', 'whatsapp').maybeSingle(),
    sb.from('alertas_log').select('alert_key').like('alert_key', 'comb_%'),
    sb.from('surtidas').select('*').gte('fecha', desdeVent).lte('fecha', fecha),
    sb.from('configuracion').select('valor').eq('clave', 'surtidas_corte').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'aud_comb_avisar').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'aforo_en_duda').maybeSingle(),
    sb.from('comb_auditoria_sombra').select('regla,veredicto,fecha,veredicto_at').order('veredicto_at', { ascending: false }).limit(300),
    // ⛔ `modelo` ENTRA ACÁ porque el rendimiento de referencia sale del modelo del tanque, y sin
    //    él no se puede saber cuántos litros justifica un kilómetro. Sin eso, quitar la exclusión
    //    de R11 convertiría cada día que el camión rodó en un faltante falso.
    sb.from('unidad_config').select('cam,capacidad_tanque_l,mide_tanque,modelo'),
    sb.from('configuracion').select('valor').eq('clave', 'aud_comb_aviso_manana').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'rol_cargos').maybeSingle(),
    sb.from('configuracion').select('valor').eq('clave', 'aud_comb_rend_ref').maybeSingle(),
  ]);
  if (cfgT.error) return json({ ok: false, error: cfgT.error.message }, 500);
  const corteSur = String(cfgCorte?.data?.valor || '').replace(/"/g, '').slice(0, 10);

  // Unidades cuyo AFORO está en discusión: al chofer no se le reclama la altura, al jefe sí.
  // Si la clave no existe o viene rota, la lista queda VACÍA y todo sigue como siempre: el
  // modo seguro de este interruptor es "no callar nada".
  let AFORO_EN_DUDA = new Set<string>();
  try {
    const cru = cfgDuda?.data?.valor;
    const obj = typeof cru === 'string' ? JSON.parse(cru) : cru;
    for (const u of (obj?.unidades || [])) AFORO_EN_DUDA.add(String(u).trim().toUpperCase());
  } catch (_e) { /* lista vacía: se avisa de todo, como antes */ }

  // ── EL RENDIMIENTO DE REFERENCIA, POR MODELO ─────────────────────────────────────────────────
  // GEMELA de `_acRefModelo` en `app.js`: la clave del mapa es un pedazo del nombre del modelo
  // («1131») y el valor son km/L. Si falta la clave, falta el modelo, o el valor no es un número,
  // devuelve null y **no se descuenta nada** — la regla queda más exigente, nunca más floja.
  // ⛔ El modo seguro de un dato que no está es no usarlo, no inventarle un valor por defecto.
  let REND_REF: Record<string, number> = {};
  try {
    const cru = cfgRendRef?.data?.valor;
    const obj = typeof cru === 'string' ? JSON.parse(cru) : cru;
    if (obj && typeof obj === 'object') REND_REF = obj as Record<string, number>;
  } catch (_e) { /* mapa vacío: no se descuenta nada */ }
  const modeloDe: Record<string, string> = {};
  for (const r of (uCfg.data || [])) modeloDe[String(r.cam)] = String(r.modelo || '').toLowerCase();
  const refModelo = (u: string): number | null => {
    const modelo = modeloDe[u] || '';
    if (!modelo) return null;
    let val: number | null = null;
    for (const k of Object.keys(REND_REF)) {
      if (k && modelo.indexOf(String(k).toLowerCase()) >= 0) {
        const v = num(REND_REF[k]);
        if (v != null && v > 0) val = v;
      }
    }
    return val;
  };

  const tanques = (cfgT.data || []).map((t: any) => {
    let tabla = t.tabla_cubicacion;
    if (typeof tabla === 'string') { try { tabla = JSON.parse(tabla); } catch { tabla = null; } }
    return { id: t.id, tipo: t.tipo, hmax: num(t.altura_max_cm), tabla, forma: t.forma ?? null, tabla_origen: t.tabla_origen ?? null, tabla_desde: t.tabla_desde ?? null };
  });
  // Sin tanques cubicados hay DOS situaciones que desde afuera se veian iguales, y una
  // de las dos es un hueco: la empresa que no usa cubicacion (ninguna unidad marcada) y
  // la que SI la usa pero no la tiene cargada. En la segunda los choferes miden en
  // centimetros y esos centimetros no se convierten en ningun litro: medido en Tony Gas
  // el 07/10, 18 unidades marcadas y 163 mediciones tomadas, y esto devolvia ok:true.
  if (!tanques.length) {
    const marcadas = (uCfg.data || []).filter((u: any) => u.mide_tanque).map((u: any) => String(u.cam || '').trim()).filter(Boolean);
    if (marcadas.length) {
      // ⛔ EL DIAGNÓSTICO TIENE QUE DISTINGUIR DOS CAUSAS QUE SE VEÍAN IGUAL, Y UNA ES PEOR.
      //    Este 409 decía «cargá las tablas de cubicación». Pero si lo que los choferes están
      //    anotando NO son centímetros, cargar la tabla convierte esos números como si lo fueran
      //    y devuelve litros con toda autoridad y completamente falsos — peor que el 409.
      //
      //    La firma es medible, y se midió el 07/11/2026:
      //      Betangar (regla de verdad):  2.724 lecturas · 21,7% múltiplos de 5 · 85 valores
      //      Tony Gas:                      311 lecturas ·  100% múltiplos de 5 · 24 valores,
      //                                     y el máximo de cada unidad CALZA con su capacidad en
      //                                     litros (tanque de 90 → 90 · de 200 → 200)
      //    Una regla leída en centímetros por veinte personas no da 100% de múltiplos de 5.
      //    ⇒ Ahí se está anotando el CONTENIDO EN LITROS en el campo de los centímetros.
      //    [[norma-una-asercion-mal-escrita-acusa-al-producto]] [[norma-control-positivo-antes-de-creerle-al-vacio]]
      const firma = await sb.from('combustible_mediciones')
        .select('altura_cm, vehiculo_id').not('altura_cm', 'is', null).order('fecha', { ascending: false }).limit(400);
      const vals = (firma.data || []).map((m: any) => Number(m.altura_cm)).filter((n) => isFinite(n));
      const mult5 = vals.filter((n) => n % 5 === 0).length;
      const pct5 = vals.length ? Math.round(1000 * mult5 / vals.length) / 10 : null;
      const distintos = new Set(vals).size;
      // El techo de cada unidad contra su capacidad declarada: si calzan, son litros.
      const capDe: Record<string, number> = {};
      for (const u of (uCfg.data || [])) if (u.capacidad_tanque_l) capDe[String(u.cam).trim()] = Number(u.capacidad_tanque_l);
      const topePorUnidad: Record<string, number> = {};
      for (const m of (firma.data || [])) {
        const u = String(m.vehiculo_id || '').trim(); const v = Number(m.altura_cm);
        if (u && isFinite(v)) topePorUnidad[u] = Math.max(topePorUnidad[u] ?? -1, v);
      }
      const conCap = Object.keys(topePorUnidad).filter((u) => capDe[u]);
      const calzanConLaCapacidad = conCap.filter((u) => topePorUnidad[u] <= capDe[u] && topePorUnidad[u] >= capDe[u] * 0.85);
      // Dos señales juntas, no una: casi todo múltiplo de 5 Y el techo pegado a la capacidad.
      const parecenLitros = vals.length >= 30 && pct5 != null && pct5 >= 90
                            && conCap.length >= 2 && calzanConLaCapacidad.length >= conCap.length / 2;
      return json({
        ok: false,
        motivo: parecenLitros
          ? 'LO QUE SE ESTÁ ANOTANDO NO PARECEN CENTÍMETROS, SINO LITROS. ' +
            `De las últimas ${vals.length} lecturas, el ${pct5}% son múltiplos de 5 y hay apenas ${distintos} valores distintos; ` +
            `y en ${calzanConLaCapacidad.length} de ${conCap.length} unidades el valor más alto que se anotó coincide con la CAPACIDAD en litros del tanque. ` +
            'Una regla leída en centímetros no da eso (en Betangar, con la misma app y regla de verdad, el 21,7% son múltiplos de 5 sobre 85 valores distintos). ' +
            '⛔ POR ESO NO ALCANZA CON CARGAR LAS TABLAS DE CUBICACIÓN: convertirían esos números como si fueran centímetros y devolverían litros falsos con toda autoridad — peor que este error. ' +
            'Primero hay que decidir cómo se mide de verdad en esta empresa: si con regla (hacen falta las medidas de cinta de cada modelo de tanque, y explicarle a los choferes que va la ALTURA en cm) ' +
            'o declarando litros a ojo (entonces el campo tiene que ser de litros, con su propia tolerancia, y no se cubica nada).'
          : 'faltan los tanques cubicados: ' + marcadas.length + ' unidad(es) marcadas para medir el tanque y 0 filas en combustible_tanques_config, ' +
            'asi que las mediciones en centimetros no se pueden convertir en litros y no hay nada que cuadrar',
        parecen_litros: parecenLitros,
        firma_de_las_lecturas: { lecturas: vals.length, pct_multiplos_de_5: pct5, valores_distintos: distintos,
                                 unidades_cuyo_tope_calza_con_la_capacidad: `${calzanConLaCapacidad.length} de ${conCap.length}` },
        unidades_marcadas: marcadas,
        mediciones_en_la_ventana: (med.data || []).length,
        avisos: 0,
      }, 409);
    }
    return json({ ok: true, nota: 'esta empresa no usa cubicación — nada que auditar', avisos: 0 });
  }

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
  // ── UN ROL SE RESUELVE POR ROSTER *O* POR CARGO ───────────────────────────────────────────────
  // 🔴 Medido el 07/11/2026: los CUATRO clones tienen la clave `configuracion.whatsapp`
  //    INEXISTENTE. `telsRol()` devolvía [] y por lo tanto `jefes` también ⇒ el resumen diario de
  //    combustible y el aviso del kill-switch **nunca le llegaron a nadie en ningún clon**, con
  //    Tony Gas encima teniendo `aud_comb_avisar='on'`. Desde afuera se veía igual que «no había
  //    nada que avisar». [[norma-la-barra-que-no-dice-que-sigue]]
  //
  // Lo que SÍ está cargado en los clones son las FICHAS (Tony Gas 59 de 65 con WhatsApp, Flotilla
  // 23 de 23) y ahí el `cargo` ya dice quién supervisa. Y es el idioma que esas apps ya usan:
  // `flotilla-resumen` busca al de mantenimiento por cargo desde antes que esto.
  //
  // Entonces un rol se resuelve por la UNIÓN de dos fuentes, y alcanza con que exista una:
  //   1. el roster (`configuracion.whatsapp`), como siempre — en Betangar sigue siendo la fuente;
  //   2. la clave `rol_cargos`, que declara de qué está hecho cada rol EN ESTA EMPRESA:
  //        {"operativo":{"cargos":["Jefe de Operaciones"]}, "socios":{"tels":["5841…"]}}
  //      Los `cargos` se resuelven contra las fichas VIVAS: el día que cambia la persona que
  //      ocupa el cargo, cambia el destinatario solo. Los `tels` son para quien no es un cargo.
  // ⛔ Si ninguna de las dos tiene nada, el rol queda VACÍO y no se elige a nadie por omisión.
  //    Un destinatario por omisión es una fuga. [[norma-un-destinatario-por-omision-es-una-fuga]]
  let roster: any[] = [];
  try { roster = JSON.parse(String(waCfg.data?.valor || '[]')); } catch { roster = []; }
  let rolCargos: Record<string, any> = {};
  try {
    const cru = cfgRolCargos?.data?.valor;
    rolCargos = (typeof cru === 'string' ? JSON.parse(cru) : cru) || {};
  } catch (_e) { rolCargos = {}; }
  // Los cargos se comparan NORMALIZADOS: la ficha de Tony Gas dice «Jefe de Flota Vehícular» con
  // tilde y «Operador de Mantenimineto» con el error de tipeo de quien la cargó. Comparar letra
  // por letra haría que el rol quedara vacío y se viera igual que un rol sin configurar.
  const telsPorCargos = (cargos: any[]): string[] => {
    const q = (cargos || []).map((c: any) => norm(c)).filter(Boolean);
    if (!q.length) return [];
    return (emps.data || [])
      .filter((e: any) => e.activo !== false && q.includes(norm(e.cargo)))
      .map((e: any) => String(e.whatsapp || e.tel || '').replace(/\D/g, ''))
      .filter(Boolean);
  };
  const telsRol = (roles: string[]): string[] => {
    const delRoster = (Array.isArray(roster) ? roster : [])
      .filter((w: any) => w.num && w.activo !== false && roles.includes(w.rol))
      .map((w: any) => String(w.num).replace(/\D/g, ''));
    const delCargo = roles.flatMap((r) => {
      const d = rolCargos[r]; if (!d) return [];
      const tels = (Array.isArray(d) ? d : (d.tels || [])).map((t: any) => String(t).replace(/\D/g, ''));
      return [...tels, ...telsPorCargos(d.cargos || [])];
    });
    return [...new Set([...delRoster, ...delCargo])].filter(Boolean);
  };
  const jefes = [...new Set([...telsRol(['mecanica', 'operativo', 'socios'])])];

  // ── A QUIÉN LE LLEGA LA PREGUNTA DE LA MAÑANA (R14) ────────────────────────────────────────────
  // Máximo (06/11/2026): «en el caso de betangar le avisas a gladys y alejandra, pero en las otras
  // empresas a los supervisores». Eso es un dato de CADA EMPRESA, no una línea de código: escrito
  // en el código, el clon de Tony Gas le escribiría a Gladys, que no trabaja ahí. Entonces:
  //   1) si la clave `aud_comb_aviso_manana` trae teléfonos, son esos (en Betangar: Gladys y
  //      Alejandra);
  //   2) si no existe, el rol `operativo`/`mecanica` del roster — el supervisor de esa empresa, que
  //      ya tiene declarado "combustible crítico" en lo que recibe.
  // ⛔ Si no hay ni clave ni rol no se elige a nadie: el aviso NO sale y la respuesta lo dice. Un
  //    destinatario por omisión es una fuga, no un default.
  //
  // 📌 LA CLAVE PUEDE DECLARAR CARGOS EN VEZ DE TELÉFONOS, y es la forma preferida:
  //      {"cargos":["Jefe de Flota Vehícular"]}   ⇒ los números salen de las fichas VIVAS
  //      {"tels":["58414…"]}                      ⇒ números fijos (para alguien que no es un cargo)
  //    Medido el 07/11/2026: los cuatro clones tienen el roster VACÍO —la clave `whatsapp` no
  //    existe— así que el rol del roster no alcanzaba y el aviso no habría salido en ninguno. Pero
  //    las fichas sí están cargadas (Tony Gas 59 de 65 con WhatsApp, Flotilla 23 de 23), y ahí el
  //    cargo ya dice quién supervisa la flota. Una lista de teléfonos a mano se desincroniza el día
  //    que esa persona cambia; un CARGO sigue apuntando a quien lo ocupa. Las dos formas conviven.
  let avisoManana: string[] = [];
  try {
    const cru = cfgManana?.data?.valor;
    const obj = typeof cru === 'string' ? JSON.parse(cru) : cru;
    const tels = (Array.isArray(obj) ? obj : (obj?.tels || []))
      .map((t: any) => String(t).replace(/\D/g, '')).filter(Boolean);
    // Misma pieza que resuelve los roles: una sola implementación del "cargo ➜ teléfonos".
    avisoManana = [...tels, ...telsPorCargos(obj?.cargos || [])];
  } catch (_e) { avisoManana = []; }
  if (!avisoManana.length) avisoManana = telsRol(['operativo', 'mecanica']);
  avisoManana = [...new Set(avisoManana)];

  // ── LA HORA DEL AVISO ES LA DE CADA PERSONA, NO LA DEL SERVIDOR ───────────────────────────────
  // El cron corre 07:00 VE. Alejandra tiene número de México (UTC−6): allá son las 5 de la mañana.
  // Así que la fila se ENCOLA ahora y se PROGRAMA para las 8 de la mañana de QUIEN la recibe — la
  // cola ya respeta `programado_para`. Código de país que no conozco ⇒ se trata como Venezuela,
  // que es la hora de la casa: eso no es adivinarle la zona a nadie, es no mover la que ya regía.
  const UTC_MENOS: Record<string, number> = { '58': 4, '52': 6 };   // ni VE ni MX mueven el reloj
  const aLasOchoDeSuManana = (tel: string): string => {
    const cc = Object.keys(UTC_MENOS).find((c) => String(tel || '').startsWith(c)) || '58';
    const ahoraUTC = new Date();
    const sale = new Date(Date.UTC(ahoraUTC.getUTCFullYear(), ahoraUTC.getUTCMonth(), ahoraUTC.getUTCDate(),
                                   (8 + UTC_MENOS[cc]) % 24, 0, 0, 0));
    // Si esa hora ya pasó, sale YA: guardarlo para mañana sería contestar una pregunta de anteayer.
    return (sale <= ahoraUTC ? ahoraUTC : sale).toISOString();
  };

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
    // ⛔ + SIGMA_CM: la regla se lee en CENTÍMETROS ENTEROS. Con un tope de 52,5 un
    //    tanque lleno se lee 53 SIEMPRE, y sin esta línea el sistema le reclamaba al
    //    chofer medio centímetro que no podía escribir. Alexander llegó a pedir perdón
    //    por eso el 15/09. La tolerancia es la del INSTRUMENTO, la misma que ya se usa
    //    para el cuadre; no un número elegido. Un 53 se cubica como tanque lleno porque
    //    `cubicar()` topa en el último punto de la tabla: no se inventa ningún litro.
    //    Lo que es error de TECLEO (54, 175, 264 cm) sigue saltando igual.
    return tq?.hmax ? (h >= 0 && h <= tq.hmax + SIGMA_CM) : h >= 0;
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
  // ⛔ EL EXAMEN ES SOLO DE R1, Y ESTO ES LO MÁS DELICADO DEL MÓDULO.
  //    Este portón es lo único que impide que el sistema vuelva a insinuarle a una persona que
  //    se robó combustible. Mide si el detector de FALTANTES acierta. Al empezar a guardar R14
  //    (sobrantes nocturnos) en la misma tabla, sus 18 filas entraban al cálculo: marcar «sí, esa
  //    noche le cargaron» habría contado como un faltante bien detectado y podía ABRIR el portón
  //    con cero faltantes verificados. Son dos preguntas distintas y dos detectores distintos.
  //    [[norma-correccion-heredada-toca-todas-las-tablas]]
  const vered = (somb.data || []).filter((x: any) => (x.regla || 'R1') === 'R1' && (x.veredicto === 'verdadera' || x.veredicto === 'falsa'));
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

  // ⛔ NO TODA UNIDAD MIDE EL TANQUE CON REGLA, Y ESTA PIEZA NO LO MIRABA.
  //    Medido el 04/09 en FLOTILLA: las FL y las FR tienen `mide_tanque=false`
  //    —solo las FC miden— y aun así se les reclamaba «no quedó registrada la
  //    medición del tanque» todos los días que trabajaban. A Adolfo Pinto (una unidad)
  //    le llegó el 03 y el 04 seguido, por un dato que a su unidad NADIE le pide.
  //    Es lo peor que puede hacer un aviso: acusar de no trabajar a quien trabajó.
  //    Y un aviso que salta siempre deja de leerse, así que también se lleva
  //    puestos a los que sí importan.
  // ⚠️ `mide_tanque` puede venir NULL en una unidad vieja que nadie configuró.
  //    Null NO es «no mide»: es «no lo declaró nadie». Se le sigue reclamando,
  //    porque callarse con lo no declarado esconde justo lo que hay que cargar.
  const noMideTanque = new Set<string>();
  (uCfg.data || []).forEach((r: any) => {
    if (r.mide_tanque === false) noMideTanque.add(String(r.cam));
  });

  // ⛔ `created_at` NO ES LA HORA EN QUE ENTRÓ EL GASOIL: es la hora en que se ESCRIBIÓ LA FILA.
  // Y `hora` tampoco: la escribe la PWA del chofer con el reloj del teléfono AL GUARDAR
  // (`chofer.html`, `hora:p2(now.getHours())…`). Ninguna columna de `surtidas` dice cuándo entró
  // el combustible al tanque. Acá hubo una máquina que fingía que sí —comparaba `created_at` contra
  // los `created_at` de las dos lecturas de regla— y costó dos cosas a la vez, medidas el
  // 08/09/2026 en Betangar:
  //   • 40 de las 86 surtidas —6.862 L de 10 camiones, con fechas del 22/07 al 01/08— se volcaron
  //     en UNA corrida el 18/08 a las 12:20:34, mismo `created_at` al microsegundo y `hora` en
  //     null. Litros de julio contados como carga de una noche de agosto: 3 de las 5 acusaciones
  //     de faltante de toda la historia eran FALSAS (1.271 L ≈ $863).
  //   • Y una surtida tecleada al volver al patio caía FUERA de su propio día: 621,6 L salían como
  //     «entró combustible sin registrarse» estando registrados, con foto y GPS.
  // La misma fila caía fuera del día y dentro de la noche. Justo al revés de donde va.
  //
  // ⇒ La carga se cuenta por la FECHA QUE DECLARÓ QUIEN SURTIÓ, que es lo único que esa fila sabe.
  // GEMELA de `_acEntradas` en `app.js`: si se toca una, se toca la otra.
  // 📌 [[norma-created-at-no-es-la-hora-del-hecho]]
  // ── UNA CARGA ASENTADA ANTES DE LA MEDICIÓN DE SALIDA YA ESTÁ DENTRO DE ESE NIVEL ────────────
  // El consumo del día se calcula `salida + cargas − llegada`, que asume que toda carga entró
  // DESPUÉS de leer la salida. Cuando no es así, esa carga se cuenta DOS VECES: está en el nivel
  // de salida y además se suma.
  //
  // Medido el 06/11/2026 en FLOTILLA: una unidad cargó 143,26 L a las 12:18 y midió la salida a las
  // 12:22 —cuatro minutos después, tanque lleno—. Su consumo del día salía **156,7 L** cuando de
  // verdad fue **13,4 L**: once veces más. Y encima disparaba R15 diciendo que la carga no cabía.
  //
  // ⚠️ Acá SÍ se puede usar el sello de tiempo, y en el cuadre de la NOCHE no. La diferencia es la
  //    distancia: allá hay que ubicar una carga dentro de una ventana de muchas horas y el sello
  //    no alcanza (de ahí salieron tres faltantes falsos). Acá los dos registros están a minutos
  //    uno del otro y la `hora` que declaró la persona coincide con su `created_at`. Se exige un
  //    margen de 15 min para no decidir por segundos.
  // 📌 Es raro —3 de 314 surtidas en FLOTILLA, 0 en Betangar— pero produce una acusación falsa y
  //    un consumo 11× inflado cuando pasa. [[norma-created-at-no-es-la-hora-del-hecho]]
  const yaEnElNivel = (u: string, f: string, s: any): boolean => {
    if (String(s.cam) !== u || String(s.fecha || '').slice(0, 10) !== f) return false;
    const tSal = medUnica
      .filter((m: any) => String(m.vehiculo_id) === u && String(m.fecha).slice(0, 10) === f && String(m.momento) === 'salida')
      .map((m: any) => ts(m.created_at)).filter((t: number | null) => t != null).sort()[0];
    const tSur = ts(s.created_at);
    if (tSal == null || tSur == null) return false;
    return tSur < (tSal as number) - 15 * 60 * 1000;
  };

  // ⛔ EL OTRO EXTREMO DE LA JORNADA: una carga asentada DESPUÉS de la lectura de LLEGADA no está
  //    en esa lectura. Lo decide EL NIVEL y no el reloj, porque el reloj se equivoca en los dos
  //    sentidos: medido el 07/11/2026 sobre 12 jornadas reales, en 5 el tanque había SUBIDO
  //    durante el día (una de 10 a 36 cm) con la carga guardada minutos después de la llegada —
  //    el combustible SÍ estaba, la fila se guardó tarde—. Restarla ahí da consumo NEGATIVO, que
  //    acusa de no haber asentado una carga que se asentó con foto y GPS (es el caso del 29/08
  //    que se arregló el 08/09). Y en las otras 7 sumarla infla el consumo hasta 446 L para 91 km.
  //      cA = salida + (carga no posterior) − llegada
  //      cA < 0 → ya está en la llegada ⇒ se cuenta · cA >= 0 → todavía no ⇒ sale del cuadre
  // ⛔ EL UMBRAL ES CERO Y NO LA TOLERANCIA: con −TOL, una jornada del 28/07 (157 km) quedaba
  //    con consumo NEGATIVO de −10,18 L que ninguna regla caza, y antes daba 1,75 km/L.
  // 📌 NO se decide por cuál cuenta "da un rendimiento más creíble": eso elegiría siempre la
  //    versión que deja al día sin culpa. El criterio es físico y no mira los km.
  // GEMELA de `_acDespDelCuadre` en `app.js` — si se toca una, se toca la otra.
  const despDelCuadre = (salida: number | null, llegada: number | null, desp: number,
                         despPost: number): number => {
    if (!(despPost > 0) || salida == null || llegada == null) return desp;
    const sin = Math.round((desp - despPost) * 100) / 100;
    const cA = Math.round((salida + sin - llegada) * 100) / 100;
    return cA >= 0 ? sin : desp;
  };

  // `despuesDe` (ms) acota a lo ASENTADO DESPUÉS de un instante. Va acá adentro y no en una cuenta
  // aparte para que el corte, el turno y `yaEnElNivel` sean LOS MISMOS: dos listas a mano se
  // desincronizan. El histórico `gasoil` no tiene hora: nunca entra en ese subconjunto.
  // ⛔ ¿ESTA CARGA ENTRO DESPUES DE UN INSTANTE DADO? 'si' | 'no' | null = NO SE PUEDE SABER.
  //    GEMELA de `_acEntroDespuesDe` en `app.js`. El GPS del camion sabe cuando estuvo DETENIDO
  //    en el punto de la surtida (`hora_gps` / `hora_gps_fin`, asentadas desde el 08/11/2026).
  //    Es un INTERVALO, no un instante, y por eso hay TRES respuestas:
  //      la parada TERMINO antes  -> 'no'   el combustible ya estaba, seguro
  //      la parada EMPEZO despues -> 'si'   no estaba, seguro
  //      el instante cae ADENTRO  -> null   el chofer midio EN la bomba: el reloj no lo sabe
  // ⚠️ EL GPS NO MANDA SOLO: se apaga, pierde senal y tiene margen. `null` NO es "no entro
  //    despues", es "no se sabe", y quien llama cae en su regla anterior (`created_at`).
  const entroDespuesDe = (s: any, instante: number | null): 'si' | 'no' | null => {
    const ini = ts(s?.hora_gps), fin = ts(s?.hora_gps_fin);
    if (ini == null || fin == null || instante == null) return null;
    if (fin <= instante) return 'no';
    if (ini > instante) return 'si';
    return null;
  };

  const entradas = (u: string, fA: string, fB: string, incluirFA: boolean, despuesDe?: number) => {
    const dentro = (f: string) => (incluirFA ? f >= fA : f > fA) && f <= fB;
    let suma = 0;
    (sur.data || []).forEach((s: any) => {
      if (String(s.cam) !== u) return;
      const f = String(s.fecha || '').slice(0, 10);
      if (corteSur && f < corteSur) return;              // antes del corte manda gasoil
      if (!dentro(f)) return;
      if (yaEnElNivel(u, f, s)) return;                  // ya está dentro del nivel de salida
      // ⛔ MANDA EL GPS CUANDO SABE; el sello de guardado es el respaldo, no al reves.
      if (despuesDe != null) {
        const v = entroDespuesDe(s, despuesDe);
        if (v === 'no') return;                            // la parada termino antes: ya estaba
        if (v == null) { const t = ts(s.created_at); if (t == null || t <= despuesDe) return; }
      }
      suma += (num(s.litros) || 0);
    });
    (gas.data || []).forEach((gg: any) => {
      if (despuesDe != null) return;                     // sin hora no se puede ubicar
      if (String(gg.cam) !== u) return;
      if (String(gg.tipo_operacion || '') === 'compra') return;   // compra = entra al galpón
      const f = String(gg.f || '').slice(0, 10);
      if (corteSur && f >= corteSur) return;             // desde el corte manda surtidas
      if (!dentro(f)) return;
      suma += (num(gg.lit) || 0);
    });
    return Math.round(suma * 100) / 100;
  };

  // ⛔ ¿EL DÍA DE ESA UNIDAD CONSUMIÓ ALGO FÍSICAMENTE IMPOSIBLE?
  //    GEMELA de `j.rendImposible` en `app.js`. Hace falta acá por un motivo concreto: el
  //    FALTANTE de la noche no puede hablar cuando el propio módulo ya sospecha que una lectura
  //    está INFLADA. Un día que "consumió implausiblemente poco" apunta a una llegada inflada, y
  //    una llegada inflada AGRANDA la caída de esa noche ⇒ faltante falso.
  //    ⚠️ El SOBRANTE no lo necesita: una llegada inflada ACHICA la subida, así que ahí no puede
  //      inventar nada. Por eso esto gatea una sola dirección.
  //    📌 Sin referencia de rendimiento devuelve false: no se sospecha de lo que no se puede
  //      medir, y la regla queda como estaba. [[norma-falta-de-dato-no-es-un-dato]]
  const rendImposibleDe = (u: string, f: string): boolean => {
    const ref = refModelo(u);
    if (ref == null || ref <= 0) return false;
    const ms = medUnica.filter((m: any) => String(m.vehiculo_id) === u && String(m.fecha).slice(0, 10) === f);
    const sa = ms.find((m: any) => String(m.momento) === 'salida');
    const ll = ms.find((m: any) => String(m.momento) === 'llegada');
    if (!sa || !ll || !alturaOk(tqDe(sa), sa.altura_cm) || !alturaOk(tqDe(ll), ll.altura_cm)) return false;
    const s2 = cubicar(tqDe(sa), sa.altura_cm), l2 = cubicar(tqDe(ll), ll.altura_cm);
    if (s2 == null || l2 == null) return false;
    const c = (ck.data || []).find((x: any) => String(x.cam) === u && String(x.fecha).slice(0, 10) === f);
    const kmS2 = km(c?.km_salida), kmE2 = km(c?.km_entrada);
    if (kmS2 == null || kmE2 == null || (kmE2 - kmS2) < 30) return false;
    const kmD = kmE2 - kmS2;
    const desp = entradas(u, f, f, true);
    const consumo = Math.round((s2 + desp - l2) * 100) / 100;
    if (consumo <= 0) return false;
    const espera = kmD / ref;
    return (kmD / consumo) > ref * 2 && (espera - consumo) > tol(tqDe(sa), sa.altura_cm, ll.altura_cm, desp);
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
    //
    // ⛔ 08/09/2026 — MIRABA CADA FILA POR SEPARADO, Y ASÍ NO SE VE UN DUPLICADO.
    //    La B009 tiene DOS surtidas de 350 L el 05/09, a las 18:08 y 18:28, con fotos DISTINTAS:
    //    el chofer la mandó dos veces. Cada una cabía; las dos juntas —700 L en un tanque de 600
    //    que salió con 297— no. Se pasaba, y con esos 700 adentro el cuadre del día quedaba
    //    inservible. La pregunta no es si cabe UNA carga: es si cabe LA DEL DÍA.
    //    Se miran las dos cosas y no se dice dos veces lo mismo.
    //    GEMELA de la R15 de `app.js` — si se toca una, se toca la otra.
    let cargaImposibleDia = false;
    if (sal) {
      const capU = capacidadDe(u);
      const nivelSal = cubicar(tqDe(sal), sal.altura_cm);
      if (capU != null && capU > 0 && nivelSal != null && alturaOk(tqDe(sal), sal.altura_cm)) {
        // ══════════════════════════════════════════════════════════════════════════════════════
        // ⛔ ESTA REGLA AFIRMABA UNA IMPOSIBILIDAD QUE NO PODÍA DEMOSTRAR (reescrita 07/11/2026)
        //
        // Comparaba las cargas del día contra el HUECO QUE HABÍA AL SALIR, más una «gracia» del
        // 25 % de la capacidad puesta a dedo como sustituto de lo que el camión podría haber
        // quemado antes de cargar. Eso no es una prueba: es una estimación disfrazada de hecho.
        //
        // El álgebra, con las cargas del día = ΣL, el nivel de salida S, el de llegada LL y la
        // capacidad C. Para que las cargas quepan hace falta consumir, antes o entre ellas,
        // al menos ΣL − (C − S). Y el consumo que el día REALMENTE tuvo sale de su propio
        // balance: Σc = S + ΣL − LL. Entonces el día es imposible solo si
        //      S + ΣL − LL  <  ΣL − (C − S)      ⇔      LL > C
        // ⇒ **el TOTAL del día nunca puede ser imposible** si la lectura de llegada es válida,
        //   y que sea válida ya lo garantiza `alturaOk`. Medido en FLOTILLA: 0 llegadas por
        //   encima de la capacidad, en toda la historia.
        //
        // Medido lo que esa rama venía haciendo, sobre 281 jornadas con carga y salida:
        //      disparaba en 110 (39 %) · demostrablemente imposibles: 31 · **81 sin poder
        //      probarlo (74 % de lo que decía)**
        // Y una de esas 81 salió el 06/11 en el resumen de FLOTILLA diciendo que lo más probable
        // era una carga cargada dos veces: una unidad había cargado 737 L con 368 L de consumo en el
        // día, y hacían falta 227. Entraba perfecto.
        //
        // ✅ LO ÚNICO QUE SE PUEDE AFIRMAR SIN SUPONER NADA: una carga SUELTA más grande que el
        //    tanque entero no entra, esté el tanque como esté y queme lo que queme.
        //    Lo demás —un consumo que los km no justifican— lo dice R4b, que es otra frase.
        //    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
        // ══════════════════════════════════════════════════════════════════════════════════════
        const delDia = (sur.data || [])
          .filter((s: any) => String(s.cam) === u && String(s.fecha).slice(0, 10) === fecha)
          // Una carga ASENTADA ANTES de la medición de salida ya está dentro de ese nivel: ni se
          // le mide el hueco ni se le suma al consumo (ver `yaEnElNivel`).
          .filter((s: any) => !yaEnElNivel(u, fecha, s));
        // ⛔ Y TAMPOCO SE DICE TODOS LOS DÍAS, PORQUE NO ES UN HECHO DEL DÍA.
        //    Medido en FLOTILLA: 31 cargas superan la capacidad declarada, y la proporción va
        //    CONTINUA de 1,001 a 1,377 veces el tanque, sin ningún corte — y siempre en las mismas
        //    unidades (una unidad, una unidad, una unidad, una unidad, una unidad, una unidad, las de tanque más grande). Una
        //    distribución así no son 31 errores de carga: es **la capacidad de la ficha que está
        //    mal**. Si el tanque de una unidad fuera de ~850 L en vez de 600, las 47 suyas entran todas.
        //    ⇒ Es un problema de la FICHA, se dice UNA VEZ POR UNIDAD y lo reporta el vigilante
        //      (`vigilar-auditoria-combustible`), que habla solo cuando algo cambia. Repetirlo en
        //      el resumen diario sería el mismo aviso 47 veces, y eso enseña a ignorarlo.
        //    Acá solo queda el caso grosero —más del doble del tanque—, que no puede ser la ficha.
        delDia.forEach((s: any) => {
          const l = num(s.litros);
          if (l == null || l <= capU * 2) return;
          cargaImposibleDia = true;
          hallazgos.push({ u, tipo: 'R15',
            txt: `quedó asentada una carga de ${fmt(l)} L y el tanque entero es de ${fmt(capU)} L: más del doble. Eso no lo explica un error de la ficha — o la carga está mal anotada, o es combustible para más de una unidad asentado en esta` });
        });
      }
    }

    const mide = !noMideTanque.has(u);
    if (mide && trabajo && !sal) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la SALIDA' });
    if (mide && trabajo && !lle) errores.push({ u, chofer, tipo: 'falta', txt: 'no quedó registrada la medición del tanque a la LLEGADA' });
    if (kmS != null && kmE != null && kmE < kmS) errores.push({ u, chofer, tipo: 'km', txt: `el kilometraje de llegada (${fmt(kmE)}) es menor que el de salida (${fmt(kmS)})` });
    if (kmS != null && kmE == null && fecha < hoyVE) errores.push({ u, chofer, tipo: 'km', txt: 'quedó sin anotar el kilometraje de entrada (el checklist del día no se cerró)' });

    for (const m of ms) {
      const tq = tqDe(m), cm = num(m.altura_cm), rec = num(m.litros_calculados);
      if (!alturaOk(tq, cm)) {
        // `solo_jefes`: el hallazgo vale igual y va al resumen, pero NO se le reclama al
        // chofer mientras la altura del tanque sea nuestra y esté en discusión.
        errores.push({ u, chofer: String(m.registrado_por || chofer), tipo: 'altura', solo_jefes: AFORO_EN_DUDA.has(String(u).trim().toUpperCase()), txt: `la medición de ${m.momento} dice ${fmt(cm)} cm y ese tanque llega hasta ${fmt(tq?.hmax)} cm` });
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
    // La ULTIMA llegada anterior dentro de la ventana. Con dias consecutivos da lo mismo que
    // antes; con un fin de semana de por medio es la unica forma de ver el tramo.
    const lleAyer = medUnica
      .filter((m: any) => String(m.vehiculo_id) === u && String(m.momento) === 'llegada'
                       && String(m.fecha).slice(0, 10) < fecha && String(m.fecha).slice(0, 10) >= desdeVent)
      .sort((x: any, y: any) => String(x.fecha).localeCompare(String(y.fecha)))
      .pop();
    // ⚠️ El km y las cargas se leen del DIA DE ESA LLEGADA, no de `previo`: con un hueco de
    //    varios dias, mirar `previo` seria mirar un dia en el que no paso nada.
    const previoN = lleAyer ? String(lleAyer.fecha).slice(0, 10) : previo;
    const kmEayer = km((ck.data || []).find((x: any) => String(x.cam) === u && String(x.fecha).slice(0, 10) === previoN)?.km_entrada);

    // ⛔ EL PISO SALE DE LOS DATOS, NO DE UN NÚMERO REDONDO. Estaba en 1 km y reportaba al jefe
    //    movimientos de patio: el 06/11 salió «una unidad: son 10 km hechos sin planilla ni checklist»,
    //    que es cierto y no sirve para nada. Medido en 901 huecos de turno a turno de FLOTILLA:
    //      2–10 km: 23 (patio, taller, acomodar la unidad) · 11–30 km: 8 · más de 30 km: 57
    //    Con piso de 10 km se van 23 de 88 avisos (el 26 %) y no se pierde ni uno de los reales.
    //    Un aviso que salta siempre no avisa de nada — y se lleva puestos los que sí importan.
    const KM_FANTASMA_MIN = 10;
    // Un salto enorme no es un viaje: es un dígito de más al tipear. Medido: 4 jornadas de 1.028
    // en FLOTILLA, una con 885.192 km (`983346` en vez de `98334`). Se dice como error de carga,
    // no como «rodó sin registrar», porque mandar a buscar ese viaje es mandar a buscar nada.
    const KM_DIA_IMPOSIBLE = 1000;
    if (kmEayer != null && kmS != null && (kmS - kmEayer) > KM_DIA_IMPOSIBLE) {
      errores.push({ u, chofer, tipo: 'km',
        txt: `el odómetro pasó de ${fmt(kmEayer)} km el ${fmtFecha(previoN)} a ${fmt(kmS)} km el ${fmtFecha(fecha)}: son ${fmt(kmS - kmEayer)} km, que no los hizo. Es un dígito de más al anotar — hay que corregir la lectura o los km de esa unidad quedan mal para siempre` });
    } else if (kmEayer != null && kmS != null && (kmS - kmEayer) > KM_FANTASMA_MIN) {
      hallazgos.push({ u, tipo: 'R11',
        txt: `marcaba ${fmt(kmEayer)} km al llegar el ${fmtFecha(previoN)} y ${fmt(kmS)} km al salir el ${fmtFecha(fecha)}: son ${fmt(kmS - kmEayer)} km hechos sin planilla ni checklist` });
    }

    // ⛔ R11 YA NO ES EXCLUYENTE CON R1 (07/11/2026). Estaba encadenado con `else if`, así que
    //    cuando el camión había rodado, R1 no se evaluaba nunca: mover la unidad 12 km alcanzaba
    //    para que una caída de 150 L no la mirara nadie. Son DOS frases distintas y pueden ser
    //    verdad a la vez. Los km ahora se DESCUENTAN del faltante (ver `volKm`) en vez de
    //    cancelar la pregunta. GEMELA del mismo cambio en `app.js`.
    // ⚠️ Lo que SÍ sigue frenando todo es un salto IMPOSIBLE de odómetro: ese km es un dedazo, y
    //    un `volKm` calculado sobre basura descontaría litros que nadie recorrió.
    const _saltoImposible = (kmEayer != null && kmS != null && (kmS - kmEayer) > KM_DIA_IMPOSIBLE);
    const _diasHueco = lleAyer
      ? Math.round((new Date(fecha + 'T12:00:00Z').getTime() - new Date(previoN + 'T12:00:00Z').getTime()) / 86400000) : 0;
    if (!_saltoImposible && sal && lleAyer && _diasHueco >= 1 && _diasHueco <= NOCHE_DIAS_MAX && kmEayer != null && kmS != null
               && alturaOk(tqDe(sal), sal.altura_cm) && alturaOk(tqDe(lleAyer), lleAyer.altura_cm)
               && !corregidas.has([u, fecha, 'salida'].join('|')) && !corregidas.has([u, previoN, 'llegada'].join('|'))) {
      const a = cubicar(tqDe(sal), sal.altura_cm), b = cubicar(tqDe(lleAyer), lleAyer.altura_cm);
      // ── LA CARGA DE «ESA NOCHE» NO SE PUEDE SABER, Y HABÍA QUE DEJAR DE FINGIR QUE SÍ ──────
      // Una surtida declara una FECHA, no una hora. Antes esto restaba la carga ubicándola con
      // `created_at`, y de ahí salían los faltantes falsos. Ahora: si hay CUALQUIER carga declarada
      // en alguno de los dos días, R1 no puede saber si entró antes o después de la lectura de la
      // noche, y SE CALLA. El agujero de registro lo reportan R9 y R13, que no acusan a nadie.
      // Cuando no hay ninguna carga cerca, el cuadre es limpio y R1 habla como siempre.
      // ⚠️ Lo que se pierde: una noche con carga ese día ya no se audita. No hay forma de auditarla
      // con los datos que existen, y acusar con datos que no distinguen es lo que trajo los tres
      // faltantes falsos. Se recupera capturando la hora REAL de la surtida.
      // GEMELA del bloque R1 de `app.js` — si se toca una, se toca la otra.
      // La ventana de cargas cubre TODO el tramo: con un fin de semana de por medio, una carga
      // del sabado quedaba afuera de la cuenta y el sobrante del lunes salia sin explicacion.
      const cargaCerca = Math.round(entradas(u, previoN, fecha, true) * 100) / 100;
      if (a != null && b != null) {
        const d = Math.round((a - b) * 100) / 100;
        const t1 = tol(tqDe(sal), lleAyer.altura_cm, sal.altura_cm, cargaCerca);
        // ═════ CADA CAUSA EMPUJA EL NIVEL EN UN SOLO SENTIDO ═════
        //   rodar    → el nivel SOLO puede BAJAR, hasta `volKm`      ⇒ se resta al FALTANTE
        //   cargar   → el nivel SOLO puede SUBIR, hasta `cargaCerca` ⇒ se resta al SOBRANTE
        //   la regla → ±2·TOL para cualquier lado                     ⇒ se resta a las dos
        //
        // ⛔ Esto reemplaza al `puedeOpinar = (cargaCerca === 0)`, que callaba las DOS direcciones.
        //    El faltante NO resta la carga, y es la parte contraintuitiva: no se sabe cuando entro,
        //    pero si entro DENTRO del tramo la perdida real es `caida + carga` y si entro ANTES es
        //    `caida`. En los dos casos es mayor o igual a la caida medida ⇒ ignorarla SUBESTIMA,
        //    nunca inventa. El sobrante SI la resta: una subida es lo que una carga explica.
        // 📌 Esto NO revive el fallo del 14/10 (3 acusaciones en noches con 200 y 400 L
        //    asentados): aquellas eran del lado del SOBRANTE, que sigue restando la carga entera.
        // GEMELA de `_acVeredictoNoche` en `app.js` — si se toca una, se toca la otra.
        const _ref = refModelo(u);
        const _kmTramo = (kmS != null && kmEayer != null) ? (kmS - kmEayer) : 0;
        const volKm = (_kmTramo > 0 && _ref != null && _ref > 0)
          ? Math.round((_kmTramo / _ref) * 100) / 100 : 0;
        const umbralFalta = Math.round((2 * t1 + volKm) * 100) / 100;
        const umbralSobra = Math.round((2 * t1 + cargaCerca) * 100) / 100;
        // ⛔ EL TEXTO SE ARMA CON LOS HECHOS. Antes afirmaba siempre «con el odometro igual y sin
        //    ninguna carga registrada»: con esta regla las dos frases pueden ser FALSAS, y un aviso
        //    que afirma algo falso se desarma la primera vez que alguien lo comprueba.
        const _porque = [
          _kmTramo > 0
            ? `rodo ${fmt(_kmTramo)} km en el tramo, que a su rendimiento explican unos ${fmt(volKm)} L`
            : 'con el odometro igual',
          cargaCerca > 0
            ? `con ${fmt(cargaCerca)} L cargados en el tramo, que solo pueden hacer el faltante MAYOR`
            : 'sin ninguna carga registrada en esos dos dias',
        ].join(' y ');
        // Sin nombre de chofer: de noche el custodio es el PATIO, no la persona que manejo.
        // ⛔ El FALTANTE no habla si el modulo ya sospecha de una lectura inflada (ver
        //    `rendImposibleDe`). GEMELA de `_sospechaLectura` en `app.js`.
        const _sospechaLectura = rendImposibleDe(u, previoN) || rendImposibleDe(u, fecha);
        if (-d > umbralFalta && !_sospechaLectura) graves.push({ u, litros: d, tol: t1, txt: `quedo el ${fmtFecha(previoN)} con ${fmt(b)} L y amanecio con ${fmt(a)} L: faltan ${fmt(Math.abs(d))} L, ${_porque} (lo que puede explicar todo eso junto mas el error de la regla son ${fmt(umbralFalta)} L)` });
        // AMANECIÓ CON MÁS. Va aparte de la subida del MISMO día (R13) porque es otra pregunta:
        // ahí el camión andaba y alguien lo cargó en ruta; acá estuvo parado toda la noche. Lleva
        // la noche, los dos litrajes y la tolerancia porque R14 PREGUNTA, y una pregunta sin el
        // dato concreto no se puede contestar. 23 noches así quedaron sin respuesta cuando esto
        // salía nada más como un total sumado (medido 06/11/2026: 3.339 L).
        else if (d > umbralSobra) entraron.push({ u, litros: d, noche: previoN, manana: fecha, tol: umbralSobra, antes: b, ahora: a });
      }
    }

    // Llegó con MÁS de lo que salió: cargó durante el día y no quedó asentado.
    if (sal && lle && alturaOk(tqDe(sal), sal.altura_cm) && alturaOk(tqDe(lle), lle.altura_cm)
        && !corregidas.has([u, fecha, 'salida'].join('|')) && !corregidas.has([u, fecha, 'llegada'].join('|'))) {
      const s2 = cubicar(tqDe(sal), sal.altura_cm), l2 = cubicar(tqDe(lle), lle.altura_cm);
      const desp2Total = entradas(u, fecha, fecha, true);   // por la FECHA declarada, no por el sello
      // Lo asentado DESPUÉS de la llegada sale del cuadre del día (ver `despDelCuadre`). 15 min de
      // margen, igual que `yaEnElNivel`: no se decide por segundos.
      const tLle = ts(lle.created_at);
      const post = tLle != null ? entradas(u, fecha, fecha, true, (tLle as number) + 15 * 60 * 1000) : 0;
      const desp2 = despDelCuadre(s2, l2, desp2Total, post);
      // Un día cuya carga no cabe no se cuadra: su consumo es falso y no puede alimentar ningún
      // número. Lo dice R15, no se esconde. GEMELA de `j.cargaImposible` en `app.js`.
      if (s2 != null && l2 != null && !cargaImposibleDia) {
        const consumo = s2 + desp2 - l2;
        if (consumo < -2 * tol(tqDe(sal), sal.altura_cm, lle.altura_cm, desp2)) entraron.push({ u, litros: Math.abs(consumo), dia: fecha });
      }
    }
  }

  // Lo que entró MIENTRAS EL CAMIÓN ANDABA se dice UNA vez y junto: el problema no es cada camión,
  // es que la carga no se está asentando. De a una línea taparía lo poco que hay que mirar.
  const entraronDia = entraron.filter((x: any) => x.dia);
  const entraronNoche = entraron.filter((x: any) => x.noche);
  if (entraronDia.length) {
    const totL = entraronDia.reduce((s: number, x: any) => s + (x.litros || 0), 0);
    const cams = [...new Set(entraronDia.map((x: any) => x.u))];
    hallazgos.push({ u: '', tipo: 'R13',
      txt: `entraron unos ${fmt(totL)} L a ${cams.length} unidad(es) (${cams.join(', ')}) sin ninguna carga registrada. Los tanques subieron y en el sistema no figura de dónde salió ese combustible — ese gasto no está entrando a la Utilidad Real` });
  }

  // ── MODO SOMBRA: el hallazgo se guarda SIEMPRE, se avise o no ──────────────────────────────
  // Este es el dataset que mide al auditor. Mientras AVISAR_SUSTRACCION esté en false no sale ni
  // un WhatsApp, pero cada faltante queda anotado con veredicto 'pendiente' para que una persona
  // lo marque verdadera o falsa. Sin ese veredicto humano guardado no hay forma objetiva de saber
  // si el módulo ya se ganó el derecho a volver a hablar — se decidiría por fe, que es como se
  // llegó al problema. Idempotente por `alert_key`: el cron puede reprocesar sin duplicar.
  // ⚠️ Los FALTANTES se guardaban para veredicto humano y los SOBRANTES no se guardaban en ningún
  // lado: se decían por WhatsApp y se perdían. Esa asimetría es la que dejó 23 noches sin cerrar —
  // nadie podía ver la lista porque no existía. Ahora R14 entra a sombra igual que R1.
  // En modo mañana el día está ABIERTO: los faltantes de R1 no se pueden anotar todavía (falta la
  // llegada de hoy), así que solo entran las filas de R14. Anotar lo otro sería guardar un
  // veredicto sobre un día que no terminó.
  if (!dry && (graves.length || entraronNoche.length)) {
    const sombra = [
      ...(soloNoche ? [] : graves).map((x: any) => ({
        alert_key: `sombra_R1_${x.u}_${fecha}`,
        fecha, regla: 'R1', cam: x.u,
        litros: x.litros, tolerancia: x.tol,
        detalle: `${x.u} ${x.txt}`,
      })),
      ...entraronNoche.map((x: any) => ({
        alert_key: `sombra_R14_${x.u}_${x.noche}`,
        fecha, regla: 'R14', cam: x.u,
        // El umbral que la regla aplica de verdad es 2·tol (`tol()` ya trae su propio ×2 adentro).
        // Se guarda ESE, no la mitad, para que la fila diga lo que el control realmente exigió.
        litros: x.litros, tolerancia: Math.round(2 * x.tol * 10) / 10,
        detalle: `${x.u} quedó el ${fmtFecha(x.noche)} con ${fmt(x.antes)} L y amaneció el ${fmtFecha(x.manana)} con ${fmt(x.ahora)} L: entraron ${fmt(x.litros)} L sin carga asentada (umbral ${fmt(2 * x.tol)} L)`,
      })),
    ];
    const up = await sb.from('comb_auditoria_sombra')
      .upsert(sombra, { onConflict: 'alert_key', ignoreDuplicates: true });
    if (up.error) return json({ ok: false, error: 'sombra: ' + up.error.message }, 500);
  }
  if (soloSombra) return json({ ok: true, soloSombra: true, fecha, graves: graves.length, nota: 'guardado en sombra, sin encolar ningún mensaje' });

  // ── Mensajes al CHOFER (solo errores de carga, agrupados por persona) ──
  const porChofer: Record<string, any[]> = {};
  errores.forEach((e) => { if (e.chofer && !e.solo_jefes) (porChofer[e.chofer] = porChofer[e.chofer] || []).push(e); });
  // En modo mañana nada de esto habla: al chofer se le reclama el día cerrado, y hoy está abierto.
  for (const ch of (soloNoche ? [] : Object.keys(porChofer))) {
    const tel = telDe(ch);
    const key = `comb_chofer_${fecha}_${norm(ch).replace(/ /g, '_')}`;
    if (yaEnviado.has(key)) continue;
    if (!tel) continue;   // sin teléfono no se puede avisar (se informa en el resumen a los jefes)
    const lista = porChofer[ch].map((e) => `• ${e.u}: ${e.txt}`).join('\n');
    const msg = `Hola ${primerNombre(ch)}, revise por favor lo del ${fmtFecha(fecha)}:\n\n${lista}\n\n` +
      `No es un reclamo: son datos que quedaron incompletos o raros y sin ellos no se puede cuadrar el combustible del día. ` +
      `Si puede corregirlo en el sistema, mejor; si no, avísele al encargado para que lo ajuste. Gracias.`;
    filas.push({ telefono: tel, mensaje: msg, tipo: 'auditoria' });
    marcar.push(key);
  }

  // ── R14: AMANECIÓ CON MÁS — la pregunta de la mañana siguiente ───────────────────────────────
  // Por qué es su propio aviso y no una línea del resumen a los jefes: esto SE PREGUNTA, y se
  // pregunta hoy, mientras la gente se acuerda de lo que cargó anoche. Durante 23 noches salió
  // nada más como un total sumado dentro de R13 —"entraron 3.339 L a 9 unidades"— y no se cerró
  // ni una: un total no se puede contestar. Con la unidad, la noche y los litros, sí.
  //
  // Va UNA sola por mañana con la lista. Seis preguntas sueltas la misma mañana (pasó: la noche
  // del 14→15/10 se le cargó a 5 unidades y a 6 no) enseñan a ignorar el aviso.
  //
  // 📌 Y es INDEPENDIENTE DEL ORIGEN, que es lo que la hace la pieza correcta: sirve igual si
  //    cargaron en estación, si cargaron del galpón —que hoy está parado pero algún día se va a
  //    usar— o si no cargó nadie y lo que hay que revisar es la lectura de la regla.
  // ⛔ PREGUNTA UN SOLO MODO, y es el de la mañana. La corrida normal de las 7:00 audita AYER, así
  //    que su R14 habla de la noche de ANTEAYER: si también preguntara, cada mañana saldrían DOS
  //    preguntas y una de las dos sería un día vieja. La corrida normal sí ANOTA en sombra (arriba),
  //    que es la red por si una salida se registra tarde y la pregunta de las 8 no la alcanzó.
  const keyNoche = `comb_noche_${fecha}`;
  if (soloNoche && entraronNoche.length && !yaEnviado.has(keyNoche) && avisoManana.length) {
    const totN = entraronNoche.reduce((s: number, x: any) => s + (x.litros || 0), 0);
    const lista = entraronNoche
      .map((x: any) => `• ${x.u}: quedó con ${fmt(x.antes)} L y amaneció con ${fmt(x.ahora)} L — entraron ${fmt(x.litros)} L`)
      .join('\n');
    const unaOVarias = entraronNoche.length === 1 ? 'una unidad amaneció' : `${entraronNoche.length} unidades amanecieron`;
    // ⛔ "Anoche" solo si la mañana auditada ES hoy. Corrido sobre un día viejo (?fecha=) decir
    //    "anoche" manda a buscar en la noche equivocada, y el que contesta no tiene cómo saberlo.
    const esHoy = fecha === hoyVE;
    const cuando = esHoy ? 'Anoche' : `La noche del ${fmtFecha(entraronNoche[0].noche)}`;
    const salioEl = esHoy ? 'la salida de hoy' : `la salida del ${fmtFecha(fecha)}`;
    const saludo = esHoy ? 'Buenos días. ' : '';
    const msg = `⛽ ${saludo}${cuando} ${unaOVarias} con más combustible del que dejó\n\n` +
      `${lista}\n\n` +
      `Son unos ${fmt(totN)} L que entraron entre la llegada del ${fmtFecha(entraronNoche[0].noche)} y ${salioEl}, ` +
      `y en el sistema no figura ninguna carga asentada esa noche. La diferencia pasa lo que puede explicar la lectura de la regla.\n\n` +
      `¿Se le cargó a ${entraronNoche.length === 1 ? 'esa unidad' : 'alguna de esas unidades'} anoche? ` +
      `Si fue en estación o del galpón, hay que asentar la surtida: sin eso el consumo del día siguiente sale mal ` +
      `y ese gasto no entra en la Utilidad Real. Si no se le cargó a ninguna, conviene volver a pasar la regla a esos tanques.\n\n` +
      `No es un reclamo a nadie: de noche el camión está en el patio. Es un registro que falta.\n` +
      `Queda anotado en Combustible → Auditoría → Modo sombra para marcarlo cuando se sepa.`;
    avisoManana.forEach((t) => filas.push({ telefono: t, mensaje: msg, tipo: 'auditoria', programado_para: aLasOchoDeSuManana(t) }));
    marcar.push(keyNoche);
  }
  // La respuesta dice por qué NO salió, que es la mitad que se necesita cuando no sale: sin esto,
  // "0 avisos" se lee igual con 0 noches que con 0 destinatarios cargados.
  if (soloNoche) {
    const motivo = entraronNoche.length === 0 ? 'ninguna unidad amaneció con más'
                 : !avisoManana.length ? '⛔ hay noches para preguntar pero NO hay destinatarios: cargá la clave `aud_comb_aviso_manana` o el rol operativo/mecanica en el roster'
                 : yaEnviado.has(keyNoche) ? 'ya se preguntó hoy' : null;
    if (dry || !filas.length) return json({ ok: true, modo: 'manana', dry, fecha, amanecio_con_mas: entraronNoche.length,
      aviso_manana_a: avisoManana.length, encolaria: filas.length, motivo, muestra: filas, detalle: { entraronNoche } });
    const insN = await sb.from('cola_mensajes').insert(filas);
    if (insN.error) return json({ ok: false, error: insN.error.message }, 500);
    await sb.from('alertas_log').insert([...new Set(marcar)].map((k) => ({ alert_key: k })));
    return json({ ok: true, modo: 'manana', fecha, amanecio_con_mas: entraronNoche.length, avisos: filas.length });
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
      // ⛔ ESTE AVISO NO PUEDE QUEDARSE MUDO. Dice que el módulo DEJÓ DE HABLAR: si no llega, nadie
      //    se entera de que se apagó y el silencio se lee igual que «no hay nada que reportar».
      //    En los clones el rol `socios` no está declarado —quién recibe en nombre del dueño lo
      //    decide Máximo— así que cae en los jefes, diciendo por qué les llegó a ellos.
      const aSocios = telsRol(['socios']);
      const destKill = aSocios.length ? aSocios : jefes;
      const txtKill = aSocios.length ? aviso
        : aviso + `\n\nℹ️ Esto normalmente va a los socios. Le llega a usted porque en esta empresa todavía no está declarado quién recibe en nombre del dueño (configuración: \`rol_cargos\`, rol \`socios\`).`;
      destKill.forEach((t) => filas.push({ telefono: t, mensaje: txtKill, tipo: 'auditoria' }));
      if (destKill.length) marcar.push(kkey);   // misma razón que arriba: sin destinatario no se sella
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
    // ⛔ LA CLAVE SE MARCA SOLO SI HUBO A QUIÉN MANDARLE. Se marcaba siempre, así que un día sin
    //    destinatarios quedaba sellado como «ya avisado» y no se recuperaba nunca. Medido en
    //    Flotilla el 07/11/2026: **65 días** marcados desde el 18/08, todos a cero personas —
    //    y al configurar por fin los destinatarios, el día de hoy ya venía quemado.
    //    Una marca de «ya se envió» que no comprueba que se enviara convierte un error de
    //    configuración en pérdida definitiva. [[norma-la-falta-de-un-dato-no-es-un-dato]]
    if (jefes.length) marcar.push(keyJefes);
    else console.log(`[jefes] ${fecha}: había ${errores.length + hallazgos.length} cosa(s) que decir y NINGÚN destinatario (roster vacío y rol_cargos sin operativo/mecanica/socios) — la clave NO se marca, así que se recupera cuando se configure`);
  }

  const resumen = { fecha, corte: corteSur || null, duplicados: dupIguales, corregidas: corregidas.size,
    // Se dice aparte: son días que salen de los números porque el dato es falso, no porque falte.
    no_confiables: noConfiables.size,
    errores: errores.length, hallazgos: hallazgos.length, graves: graves.length,
    // R14 sale en la respuesta con sus destinatarios: así se ve a quién le habla sin leer el código,
    // y si la lista está vacía se ve que por eso no salió (y no porque no hubiera nada que preguntar).
    amanecio_con_mas: entraronNoche.length, aviso_manana_a: avisoManana.length,
    // ⛔ El conteo de destinatarios sale SIEMPRE. Sin esto, "0 avisos" se lee igual con nada que
    //    decir que con cosas que decir y nadie a quien decírselas — que es lo que pasó 65 días.
    jefes: jefes.length, fuente_destinatarios: { roster: roster.length, rol_cargos: Object.keys(rolCargos).filter((k) => !k.startsWith('_')) },
    // El estado del portón sale siempre en la respuesta: si alguien se pregunta por qué no avisó,
    // acá está la razón exacta, sin tener que leer el código.
    porton: { avisa: AVISAR_SUSTRACCION, aforoOk, examenOk, interruptor, dosFalsas, evaluados: vered.length, precision: Math.round(prec * 100) } };
  // ⚠️ El seco devolvía SOLO conteos ("hallazgos: 2"), y con eso no se puede comprobar nada: hay que
  //    creerle al número. El modo existe justamente para ver qué DIRÍA antes de que lo diga, así que
  //    devuelve también el detalle. Sin esto, verificar un control nuevo obliga a mandarlo de verdad.
  if (dry) return json({ ok: true, dry: true, ...resumen, encolaria: filas.length, muestra: filas.slice(-2),
    detalle: { errores, hallazgos, graves, entraronNoche } });
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
