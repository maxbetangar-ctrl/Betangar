// Pruebas de las funciones críticas de Betangar (app.js).
// Correr: `node test/test.js`  (sale con código 1 si algo falla → sirve de gate).
const app = require('./harness');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}

// Confirmar que las funciones se cargaron desde app.js
console.log('Funciones cargadas:');
['_normNom', '_nomCasa', '_rosterCuadra', '_jornadaEspecial', 'getTasaFecha', 'compCostoUnit'].forEach(function (f) {
  ok(f + ' definida', typeof app[f] === 'function');
});

// ── _normNom: normaliza (mayúsculas, sin acentos, sin dobles espacios) ──
console.log('\n_normNom:');
eq("acentos + espacios", app._normNom('  José   Pérez  '), 'JOSE PEREZ');
eq("Ñ + símbolos se ELIMINAN (guion/apóstrofe unen, no separan)", app._normNom("Núñez-D'Angelo"), 'NUNEZDANGELO');
eq("vacío", app._normNom(null), '');

// ── _nomCasa: match nombre planilla vs empleado (conservador) ──
console.log('\n_nomCasa:');
ok("exacto", app._nomCasa('REINALDO FARIA', 'REINALDO FARIA') === true);
ok("corto vs completo casa", app._nomCasa('REINALDO FARIA', 'REINALDO ENRIQUE FARIA PARRA') === true);
ok("typo de primer nombre NO casa (YURBENIS/YURVENIS)",
  app._nomCasa('YURBENIS BERMUDEZ', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ') === false);
ok("homónimo de apellido NO casa (distinto primer nombre)",
  app._nomCasa('AMERICO GONZALEZ', 'RICHARD ANTONIO GONZALEZ URDANETA') === false);
ok("mismo primer nombre + apellido común casa",
  app._nomCasa('AMERICO GONZALEZ', 'AMERICO GONZALEZ URDANETA') === true);
ok("vacío NO casa", app._nomCasa('', 'AMERICO GONZALEZ') === false);

// ── _rosterCuadra: las dos columnas de la Lista Maestra hablan de la MISMA persona ──
// El 06/08 el roster de ayudantes quedó corrido una fila (se insertó a alguien SOLO en la
// columna del nombre corto): "ALEXANDER PAZ" pasó a mapear a "CARLOS ALFREDO MONTIEL
// VILLALOBOS" y 24 planillas de Paz se guardaron a nombre de Montiel. Estas pruebas fijan
// que el guard cace ESO sin acusar a los typos que el roster trae de fábrica.
console.log('\n_rosterCuadra:');
ok("EL BUG DEL 06/08: corto y completo de dos personas distintas → NO cuadra",
  app._rosterCuadra('ALEXANDER PAZ', 'CARLOS ALFREDO MONTIEL VILLALOBOS') === false);
ok("Paz con su propio nombre completo sí cuadra",
  app._rosterCuadra('ALEXANDER PAZ', 'ALEXANDER ARTURO PAZ GONZALEZ') === true);
ok("Montiel con su propio nombre completo sí cuadra",
  app._rosterCuadra('CARLOS ALFREDO  MONTIEL', 'CARLOS ALFREDO MONTIEL VILLALOBOS') === true);
// Tolerancia obligatoria: el roster real trae estos typos y NINGUNO puede dar falsa alarma.
// (Por eso el guard no usa _nomCasa, que exige primer nombre exacto y los reprobaría a todos.)
ok("typo de primer nombre tolerado (ANDRI/ANDRY): comparten CUBA",
  app._rosterCuadra('ANDRI CUBA', 'ANDRY JOSE CUBA SUAREZ') === true);
ok("typo tolerado (YIBER/YIRBER): comparten GONZALEZ",
  app._rosterCuadra('YIBER GONZALEZ', 'YIRBER LENITHON GONZALEZ MONTIEL') === true);
ok("typo tolerado (JONH/JHON): comparten DELGADO",
  app._rosterCuadra('JONH J DELGADO', 'JHON JAIRO DELGADO GONZALEZ') === true);
ok("typo tolerado (YURBENIS/YURVENIS): comparten BERMUDEZ",
  app._rosterCuadra('YURBENIS BERMUDEZ', 'YURVENIS FRANCISCO BERMUDEZ SUAREZ') === true);
ok("apellido acortado tolerado (ARANGURE/ARANGUREN): comparten JOSE",
  app._rosterCuadra('JOSE ARANGURE', 'JOSE ELITE ARANGUREN GONZALEZ') === true);
ok("mismo nombre en las dos columnas cuadra",
  app._rosterCuadra('RICARDO LOPEZ', 'RICARDO LOPEZ') === true);
ok("el chofer Hernández con SU completo cuadra (fila 34 ya corregida)",
  app._rosterCuadra('ALEXANDER HERNANDEZ', 'ALEXANDER ENRIQUE HERNANDEZ PRIETO') === true);
ok("Hernández apuntando al completo de Paz → NO cuadra… salvo el nombre de pila",
  app._rosterCuadra('ALEXANDER HERNANDEZ', 'ALEXANDER ARTURO PAZ GONZALEZ') === true);
ok("nombres sin palabras de ≥4 letras: no hay con qué juzgar, NO se acusa",
  app._rosterCuadra('ABC', 'XYZ') === true);

// ── CARPETA DEL AUDITOR: fecha de corte y montos repetidos ──
// Lo que un auditor descubre solo cuesta más caro que lo que uno le declara. La pieza que importa
// no es ningún listado: es que cada sección diga desde cuándo hay datos.
console.log('\ncarpeta del auditor:');
(function () {
  var GV = app.gv, campos = {};
  app.gv = function (id) { return campos[id] || ''; };

  eq("corte = la fecha del registro MÁS VIEJO, no una configurada a mano",
    app._capCorte([{ f: '2026-06-15' }, { f: '2026-04-01' }, { f: '2026-07-20' }], 'f'), '2026-04-01');
  eq("sin datos no hay corte", app._capCorte([], 'f'), null);
  eq("ignora fechas vacías", app._capCorte([{ f: '' }, { f: '2026-05-02' }], 'f'), '2026-05-02');

  // EL CASO REAL: la auditora pide junio y las cuentas por pagar arrancan el 09/07.
  var r = { d: '2026-06-01', h: '2026-06-30' };
  ok("período que empieza ANTES del primer dato → aviso rojo",
    app._capAviso('2026-07-09', r, 'cuentas por pagar').indexOf('cap-falta') >= 0);
  ok("y dice la fecha real del primer registro",
    app._capAviso('2026-07-09', r, 'cuentas por pagar').indexOf('09/07/2026') >= 0);
  ok("período cubierto → aviso verde",
    app._capAviso('2026-04-01', r, 'mantenimiento').indexOf('cap-ok') >= 0);
  ok("sin ningún registro → dice que el punto no se puede responder",
    app._capAviso(null, r, 'cuentas por pagar').indexOf('no se puede responder') >= 0);

  // Rango
  ok("dentro del rango", app._capEn('2026-06-15', r) === true);
  ok("antes del rango queda fuera", app._capEn('2026-05-31', r) === false);
  ok("después del rango queda fuera", app._capEn('2026-07-01', r) === false);
  ok("fecha vacía queda fuera", app._capEn('', r) === false);
  ok("acepta timestamp (corta a 10)", app._capEn('2026-06-15T14:30:00', r) === true);

  // MONTOS REPETIDOS — el caso real del 29/06 que la auditora preguntó y no vino con lista.
  var movs = [
    { fecha: '2026-06-29 15:32', monto: 386447.35, ref: 'A1' },
    { fecha: '2026-06-29 16:18', monto: 386447.35, ref: 'A2' },
    { fecha: '2026-06-29 15:32', monto: 96611.84, ref: 'B1' },
    { fecha: '2026-06-29 16:19', monto: 96611.84, ref: 'B2' },
    { fecha: '2026-06-29 16:35', monto: 658651.20, ref: 'C1' },
    { fecha: '2026-06-30 09:08', monto: 386447.35, ref: 'D1' }
  ];
  var rep = app._capRepetidos(movs);
  eq("encuentra los DOS pares del 29/06", rep.length, 2);
  eq("cada par trae sus dos movimientos", rep[0].movs.length + rep[1].movs.length, 4);
  ok("el monto solo no basta: el mismo monto en OTRO día no es un par",
    rep.every(function (x) { return x.fecha === '2026-06-29'; }));
  eq("un monto único no entra", app._capRepetidos([{ fecha: '2026-06-29', monto: 5, ref: 'X' }]).length, 0);

  app.gv = GV;
})();

// ── CARNETS: buscar, filtrar por cargo y marcar varios de cargos DISTINTOS ──
// Pedido de Yinet (RRHH) 06/08: «poder buscar por nombre, seleccionar varios de diferentes cargos
// y seleccionar todos de un cargo, para imprimir todos en un mismo archivo».
console.log('\ncarnets (filtro + selección):');
(function () {
  var EMPS_ORIG = app.EMPLEADOS, GV_ORIG = app.gv, RENDER_ORIG = app.renderCarnetsPreview;
  var campos = {};
  app.gv = function (id) { return campos[id] || ''; };
  app.renderCarnetsPreview = function () {};   // se prueba la selección, no el dibujo
  app.EMPLEADOS = [
    { id: 'E1', nombre: 'NESTOR ANTONIO BRIÑEZ DELGADO', cargo: 'Ayudante', unidad: 'JAC-B008', cedula: 'V-1', activo: true, foto: 'x' },
    { id: 'E2', nombre: 'JHAN CARLOS ROA OCHOA', cargo: 'Chofer', unidad: 'JAC-B006', cedula: 'V-2', activo: true, foto: 'x' },
    { id: 'E3', nombre: 'ALEXIS ALBERTO FERRER MAVAREZ', cargo: 'Ayudante', unidad: 'JAC-B005', cedula: 'V-3', activo: true, foto: 'x' },
    { id: 'E4', nombre: 'OMAR DE JESUS NAVA MARILLO', cargo: 'Chofer', unidad: 'JAC-B011', cedula: '', activo: true, foto: '' },
    { id: 'E5', nombre: 'YIRBER LENITHON GONZALEZ MONTIEL', cargo: 'Ayudante', unidad: 'JAC-B003', cedula: 'V-5', activo: false, foto: 'x' },
    { id: 'E6', nombre: 'IMAU EXTERNO', cargo: 'Ayudante', unidad: 'ADM', cedula: 'V-6', activo: true, imau: true, foto: 'x' }
  ];
  var ids = function (l) { return l.map(function (e) { return e.id; }).sort().join(','); };

  app.CARNET_SEL = {}; campos = {};
  eq("elegibles: fuera el inactivo y el IMAU", ids(app._carnetElegibles()), 'E1,E2,E3,E4');
  eq("sin filtros se ven todos los elegibles", ids(app._carnetsFiltrados()), 'E1,E2,E3,E4');

  campos = { 'carn-cargo': 'Chofer' };
  eq("filtro por cargo", ids(app._carnetsFiltrados()), 'E2,E4');
  campos = { 'carn-buscar': 'ferrer' };
  eq("buscar por apellido, sin importar mayúsculas", ids(app._carnetsFiltrados()), 'E3');
  campos = { 'carn-buscar': 'JAC-B008' };
  eq("buscar por unidad", ids(app._carnetsFiltrados()), 'E1');
  campos = { 'carn-cargo': 'Ayudante', 'carn-buscar': 'alexis' };
  eq("cargo y búsqueda se combinan", ids(app._carnetsFiltrados()), 'E3');

  // EL PEDIDO DE FONDO: marcar todos los de un cargo, cambiar de cargo y marcar otros.
  app.CARNET_SEL = {};
  campos = { 'carn-cargo': 'Chofer' };
  app.carnetSelTodos(true);
  eq("«marcar los que veo» con un cargo elegido = todos los de ese cargo", ids(app._carnetsAImprimir()), 'E2,E4');
  campos = { 'carn-cargo': 'Ayudante' };
  app.carnetSelTodos(true);
  eq("al cambiar de cargo y marcar, los anteriores SIGUEN marcados",
    ids(app._carnetsAImprimir()), 'E1,E2,E3,E4');
  eq("y lo que se VE sigue siendo solo el cargo filtrado", ids(app._carnetsFiltrados()), 'E1,E3');

  app.carnetToggle('E1');
  eq("destildar uno lo saca de la impresión", ids(app._carnetsAImprimir()), 'E2,E3,E4');
  app.carnetToggle('E1');
  eq("volver a tildarlo lo repone", ids(app._carnetsAImprimir()), 'E1,E2,E3,E4');

  app.carnetSelTodos(false);
  eq("desmarcar limpia TODO, no solo lo visible", Object.keys(app.CARNET_SEL).length, 0);
  eq("sin nada marcado se imprime lo que se ve", ids(app._carnetsAImprimir()), 'E1,E3');
  campos = {};
  eq("y sin filtros, lo que se ve son todos", ids(app._carnetsAImprimir()), 'E1,E2,E3,E4');

  app.EMPLEADOS = EMPS_ORIG; app.gv = GV_ORIG; app.renderCarnetsPreview = RENDER_ORIG; app.CARNET_SEL = {};
})();

// ── _jornadaEspecial: el turno nocturno de corredores es OTRA jornada ──
// Alejandra (QA/RRHH), 06/08: además del recorrido normal hay viajes nocturnos de corredores, y
// esa planilla va marcada `ruta=CORREDORES` / `parroquia=JORNADA ESPECIAL`. La misma persona
// puede hacer las dos el mismo día en unidades distintas — como Alexander Paz el 11/07.
console.log('\n_jornadaEspecial:');
ok("marcada en la parroquia",
  app._jornadaEspecial({par:'JORNADA ESPECIAL', r:'CORREDORES'}) === true);
ok("solo en la parroquia (11 planillas reales así)",
  app._jornadaEspecial({par:'JORNADA ESPECIAL', r:'CARMELO URDANETA'}) === true);
ok("solo en la ruta (4 planillas reales así)",
  app._jornadaEspecial({par:'VENANCIO PULGAR', r:'CORREDORES'}) === true);
ok("EL CASO REAL 11/07 B008: recorrido normal, NO es especial",
  app._jornadaEspecial({par:'VENANCIO PULGAR', r:'CARMELO URDANETA'}) === false);
ok("tolera minúsculas y acentos",
  app._jornadaEspecial({par:'Jornada Especial', r:''}) === true);
ok("'CORREDOR' en singular también cuenta",
  app._jornadaEspecial({par:'', r:'Corredor Norte'}) === true);
ok("sin datos NO es especial", app._jornadaEspecial({par:'', r:''}) === false);
ok("null NO revienta", app._jornadaEspecial(null) === false);

// ── getTasaFecha: tasa congelada por fecha (regla contable) ──
console.log('\ngetTasaFecha:');
app.TASAS_DIARIAS = { '2026-06-23': { dolar: 617.64, euro: 634.4, binance: 788.49 } };
eq("fecha existente (dolar)", app.getTasaFecha('2026-06-23', 'dolar'), 617.64);
eq("acepta timestamp (slice a 10)", app.getTasaFecha('2026-06-23T10:00:00Z', 'dolar'), 617.64);
eq("euro", app.getTasaFecha('2026-06-23', 'euro'), 634.4);
eq("fecha sin tasa → null (nunca USD=Bs)", app.getTasaFecha('2026-06-22', 'dolar'), null);
eq("default tipo = dolar", app.getTasaFecha('2026-06-23'), 617.64);
// Fin de semana / feriado → usa el día hábil anterior (≤7 días atrás)
app.TASAS_DIARIAS = { '2026-06-19': { dolar: 611.5 } }; // viernes
eq("sábado usa la tasa del viernes", app.getTasaFecha('2026-06-20', 'dolar'), 611.5);
eq("domingo usa la tasa del viernes", app.getTasaFecha('2026-06-21', 'dolar'), 611.5);
eq("más de 7 días sin tasa previa → null", app.getTasaFecha('2026-07-01', 'dolar'), null);

// ── compCostoUnit: precio $/L FIJO por fuente (sin DOM → usa defaults) ──
console.log('\ncompCostoUnit (defaults, sin inputs en el DOM stub):');
app.compCostoUnit('tumaca', function (v) { eq("tumaca default 0.83", v, 0.83); });
app.compCostoUnit('boscan', function (v) { eq("boscan default 0.78", v, 0.78); });

// ── _nombreCanonico: alias de nombres mal escritos en planillas ──
console.log('\n_nombreCanonico (alias de typos):');
eq("YURBENIS -> YURVENIS (full)", app._nombreCanonico('YURBENIS BERMUDEZ'), 'YURVENIS FRANCISCO BERMUDEZ SUAREZ');
eq("Jose Arangure -> ARANGUREN", app._nombreCanonico('Jose Arangure'), 'JOSE ELITE ARANGUREN GONZALEZ');
eq("YIBER -> YIRBER", app._nombreCanonico('yiber gonzalez'), 'YIRBER LENITHON GONZALEZ MONTIEL');
eq("nombre sin alias ni empleado -> uppercase", app._nombreCanonico('Pedro Perez'), 'PEDRO PEREZ');

// ── imauViajesPlanilla: cuenta la marca "IMAU" en la planilla (ay1/ay2/ay3) × viajes ──
console.log('\nimauViajesPlanilla (marca "IMAU", sin nombres):');
eq("una fila IMAU = sus viajes", app.imauViajesPlanilla([{ay1:'IMAU',t:3}]), 3);
eq("ignora ayudantes con nombre", app.imauViajesPlanilla([{ay1:'IMAU',t:3},{ay1:'JUAN PEREZ',t:2}]), 3);
eq("minúsculas/espacios cuentan", app.imauViajesPlanilla([{ay2:'  imau ',t:4}]), 4);
eq("dos IMAU en la fila = 2× viajes", app.imauViajesPlanilla([{ay1:'IMAU',ay2:'IMAU',t:3}]), 6);
eq("sin IMAU = 0", app.imauViajesPlanilla([{ay1:'PEDRO',ay2:'',t:5}]), 0);
eq("'IMAU' parcial NO cuenta (exacto)", app.imauViajesPlanilla([{ay1:'IMAUX',t:5}]), 0);
eq("lista vacía = 0", app.imauViajesPlanilla([]), 0);

// ── DINERO: retenciones (money.js) — la fórmula que cobra/concilia. Si cambia un %, esto avisa. ──
console.log('\ncalcRetenciones / perfilRetencion (money.js):');
const aprox = (name, got, exp) => ok(name + ' (' + got + '≈' + exp + ')', Math.abs(got - exp) < 0.005);
ok('calcRetenciones definida', typeof app.calcRetenciones === 'function');
ok('perfilRetencion definida', typeof app.perfilRetencion === 'function');
if (typeof app.calcRetenciones === 'function') {
  const r = app.calcRetenciones(10000, app.RET_DEFAULT, null);
  aprox('IVA 16%', r.iva, 1600);
  aprox('total c/IVA', r.total, 11600);
  aprox('ret IVA 75%', r.retIVA, 1200);
  aprox('ret ISLR 2%', r.retISLR, 200);
  aprox('ret Municipal 1%', r.retMun, 100);
  aprox('timbre 0.1%', r.timbre, 10);
  aprox('fiel 10%', r.fiel, 1000);
  aprox('NETO Alcaldía', r.neto, 9090);
  aprox('resp. social 3%', r.respSocial, 300);
  const sumaRet = r.retIVA + r.retISLR + r.retMun + r.timbre + r.fiel + r.laboral;
  aprox('neto + retenciones = total (no se pierde un centavo)', r.neto + sumaRet, r.total);
  aprox('laboral manual 500 -> neto 8590', app.calcRetenciones(10000, app.RET_DEFAULT, 500).neto, 8590);
  const p = app.perfilRetencion({ id: 'X', retenciones: { fiel: 0, respSocial: 0, retISLR: 0.03 } });
  aprox('perfil propio: ISLR 3%', p.retISLR, 0.03);
  aprox('perfil propio: IVA sigue default', p.iva, 0.16);
  const r2 = app.calcRetenciones(10000, p, 0);
  aprox('contrato sin fiel -> 0', r2.fiel, 0);
  aprox('contrato sin resp.social -> 0', r2.respSocial, 0);
  ok('perfilRetencion(null) = RET_DEFAULT', JSON.stringify(app.perfilRetencion(null)) === JSON.stringify(app.RET_DEFAULT));
  aprox('base invalida -> neto 0', app.calcRetenciones('abc', app.RET_DEFAULT, null).neto, 0);
}

// ── PERSISTENCIA: cola offline / dead-letter / reintento (la capa donde vivían los bugs) ──
// Es justo lo que el audit pedía cubrir: que un fallo NO se pierda en silencio (cae al
// dead-letter), que la red reintente y tras 3 intentos también caiga al dead-letter, y que
// la cola reintente como UPSERT (no INSERT) cuando la tabla tiene clave de conflicto.
function respCola(b){
  if(b==='neterr')return Promise.reject(new Error('sin red'));        // falla de red → reintentar
  if(b==='srverr')return Promise.resolve({error:{message:'dup key'}}); // error de servidor → dead-letter
  return Promise.resolve({error:null});                                // ok
}
function mkSupa(behavior, calls){
  return { from:function(t){ return {
    insert:function(rows){ calls.push({t:t,method:'insert'}); return respCola(behavior); },
    upsert:function(rows,opts){ calls.push({t:t,method:'upsert',oc:opts&&opts.onConflict}); return respCola(behavior); }
  };}};
}
function resetCola(){ app.COLA_OFFLINE=[]; app.COLA_FALLIDOS=[]; app._procesandoCola=false; }

(async function runAsync(){
  console.log('\nguardarEnCola (onConflict por tabla):');
  ok('guardarEnCola definida', typeof app.guardarEnCola === 'function');
  ok('procesarColaOffline definida', typeof app.procesarColaOffline === 'function');
  resetCola();
  app.guardarEnCola('abonos', { fact: 'M1', m: 5 });
  eq('abonos → onConflict "fact"', app.COLA_OFFLINE[0].oc, 'fact');
  app.guardarEnCola('planillas', { p: '00251' });
  eq('planillas → onConflict "p"', app.COLA_OFFLINE[1].oc, 'p');
  app.guardarEnCola('km_data', { cam: 'JAC-B001' });
  eq('tabla sin clave → oc null', app.COLA_OFFLINE[2].oc, null);
  app.guardarEnCola('abonos', { fact: 'M2' }, 'custom');
  eq('oc explícito gana sobre el mapa', app.COLA_OFFLINE[3].oc, 'custom');
  eq('_try arranca en 0', app.COLA_OFFLINE[0]._try, 0);

  app.DB_READY = true;

  console.log('\nprocesarColaOffline — ÉXITO:');
  resetCola();
  var calls = [];
  app.supabase = mkSupa('ok', calls);
  app.COLA_OFFLINE = [{ t: 'abonos', d: { fact: 'M9' }, _try: 0, oc: 'fact' }];
  await app.procesarColaOffline();
  eq('cola vacía tras sincronizar', app.COLA_OFFLINE.length, 0);
  eq('nada al dead-letter', app.COLA_FALLIDOS.length, 0);
  eq('con oc → reintenta como UPSERT (no INSERT)', calls[0] && calls[0].method, 'upsert');
  eq('UPSERT lleva el onConflict', calls[0] && calls[0].oc, 'fact');

  console.log('\nprocesarColaOffline — sin clave usa INSERT:');
  resetCola();
  var calls2 = [];
  app.supabase = mkSupa('ok', calls2);
  app.COLA_OFFLINE = [{ t: 'km_data', d: { cam: 'X' }, _try: 0, oc: null }];
  await app.procesarColaOffline();
  eq('sin oc → INSERT plano', calls2[0] && calls2[0].method, 'insert');

  console.log('\nprocesarColaOffline — ERROR DE SERVIDOR → dead-letter (no se pierde):');
  resetCola();
  app.supabase = mkSupa('srverr', []);
  app.COLA_OFFLINE = [{ t: 'abonos', d: { fact: 'DUP' }, _try: 0, oc: 'fact' }];
  await app.procesarColaOffline();
  eq('no se reencola (error del servidor no es de red)', app.COLA_OFFLINE.length, 0);
  eq('cae al dead-letter visible', app.COLA_FALLIDOS.length, 1);
  ok('dead-letter guarda el motivo', /servidor/.test((app.COLA_FALLIDOS[0] || {}).motivo || ''));

  console.log('\nprocesarColaOffline — RED falla: reintenta y a los 3 intentos → dead-letter:');
  resetCola();
  app.supabase = mkSupa('neterr', []);
  app.COLA_OFFLINE = [{ t: 'planillas', d: { p: '1' }, _try: 0, oc: 'p' }];
  await app.procesarColaOffline();
  eq('1er fallo de red → reencolado', app.COLA_OFFLINE.length, 1);
  eq('_try incrementado a 1', app.COLA_OFFLINE[0]._try, 1);
  eq('aún no al dead-letter', app.COLA_FALLIDOS.length, 0);
  await app.procesarColaOffline(); // intento 2
  eq('_try=2 sigue reencolado', app.COLA_OFFLINE.length === 1 && app.COLA_OFFLINE[0]._try, 2);
  await app.procesarColaOffline(); // intento 3 → dead-letter
  eq('tras 3 intentos sale de la cola', app.COLA_OFFLINE.length, 0);
  eq('tras 3 intentos → dead-letter (no se pierde en silencio)', app.COLA_FALLIDOS.length, 1);

  console.log('\nexportNomExcel (arma hojas desde _ultimaNomina):');
  ok('exportNomExcel definida', typeof app.exportNomExcel === 'function');
  var sheets = [];
  // El stub tiene que cubrir lo que la app usa DE VERDAD. Desde el formato único de Excel de Maxware
  // (`maxware-excel.js`), las hojas se arman con `aoa_to_sheet` —matriz de filas, para poder poner
  // título, encabezados y anchos— y ya no con `json_to_sheet`. El stub viejo solo tenía
  // `json_to_sheet`, así que la exportación reventaba y salían 0 hojas: el test decía la verdad.
  // Se dejan los dos para no atarlo a una sola forma.
  app.XLSX = {
    utils: {
      book_new: function () { return {}; },
      json_to_sheet: function (rows) { return { __rows: rows }; },
      aoa_to_sheet: function (aoa) { return { __aoa: aoa }; },
      book_append_sheet: function (wb, ws, name) { sheets.push({ name: name, rows: ws.__rows || ws.__aoa }); }
    },
    write: function () { return new Uint8Array(0); },
    writeFile: function (wb, fname) { sheets._fname = fname; }
  };
  app.TASAS.bcvDolar = 617; // simula tasa ya cargada de la API (si no, exportNomExcel pediría la manual)
  app._ultimaNomina = {
    sem: 'S1', mes: '2026-06', tasa: 617, totCh: 100, totAy: 50, totAdm: 0, totImau: 0, totBs: 92550,
    fdesde: '2026-06-01', fhasta: '2026-06-07',
    choferes: [{ n: 'JUAN', u: 'JAC-B001', viajes: 10, pat: 0, usd: 80, bs: 49360 }],
    ayudantes: [{ n: 'PEDRO', u: 'JAC-B001', tipo: 'interno', viajes: 8, pat: 0, usd: 40, bs: 24680 }]
  };
  app.exportNomExcel();
  eq('genera 3 hojas (Choferes, Ayudantes, Resumen)', sheets.map(function (s) { return s.name; }), ['Choferes', 'Ayudantes', 'Resumen']);
  // Desde el formato unico de Maxware las hojas son MATRIZ (titulo + encabezados + filas), no una
  // lista de objetos. Se busca el valor en la matriz en vez de por nombre de propiedad: lo que
  // importa es que el neto del chofer viaje a la hoja, no la forma en que XLSX la recibe.
  var _plano = function (rows) { return JSON.stringify(rows || []); };
  ok('hoja Choferes lleva el neto $ (80)', _plano(sheets[0].rows).indexOf('80') >= 0);
  ok('nombre de archivo con sufijo de semana', /S1/.test(sheets._fname || ''));
  var resumen = sheets[2].rows;
  ok('Resumen incluye la tasa', /Tasa/.test(_plano(resumen)) && _plano(resumen).indexOf('617') >= 0);
  sheets.length = 0;
  app._ultimaNomina = null;
  app.exportNomExcel(); // sin nómina calculada → no debe armar hojas ni lanzar
  eq('sin nómina calculada no exporta', sheets.length, 0);

  console.log('\ntasaOManual (prioridad API, manual solo si falla):');
  ok('tasaOManual definida', typeof app.tasaOManual === 'function');
  app.TASAS.bcvDolar = 620;
  var gotTasa = null, llamado = 0;
  app.tasaOManual('bcvDolar', function (v) { gotTasa = v; llamado++; });
  eq('con tasa de la API → callback directo con esa tasa (sin pedir manual)', gotTasa, 620);
  eq('callback se ejecuta una sola vez', llamado, 1);
  eq('getTasa devuelve la de la API', app.getTasa('bcvDolar'), 620);
  app.TASAS.bcvDolar = 0;
  eq('sin tasa cargada getTasa → null (no inventa un número)', app.getTasa('bcvDolar'), null);

  console.log('\nmulta en divisa (USD/EUR) → USD para nómina, congela Bs al pagar:');
  ok('_multaDivToUsd definida', typeof app._multaDivToUsd === 'function');
  ok('_multaCuotaUsd definida', typeof app._multaCuotaUsd === 'function');
  app.TASAS.bcvDolar = 617;
  app.TASAS.bcvEuro = 634;
  eq('USD se queda igual', app._multaDivToUsd(100, 'USD'), 100);
  eq('EUR → USD vía euro/dolar (100€ × 634/617)', Math.round(app._multaDivToUsd(100, 'EUR') * 100) / 100, Math.round(100 * 634 / 617 * 100) / 100);
  eq('EUR sin tasa euro → 0 (no inventa)', (function () { app.TASAS.bcvEuro = 0; var r = app._multaDivToUsd(100, 'EUR'); app.TASAS.bcvEuro = 634; return r; })(), 0);
  // multa USD: cuota en USD directa; legacy Bs: cuotaBs/tasa
  eq('cuota USD multa nueva', app._multaCuotaUsd({ moneda: 'USD', cuotaDiv: 25 }), 25);
  eq('cuota legacy Bs → USD (15420/617=25)', Math.round(app._multaCuotaUsd({ cuotaBs: 15420 })), 25);
  eq('monto empresa EUR → USD', Math.round(app._multaMontoUsd({ moneda: 'EUR', montoDiv: 200 })), Math.round(200 * 634 / 617));
  // Congelamiento al pagar: cuotaBs frozen = cuotaUsd × tasa$ del día del pago
  var cuotaUsdUSD = app._multaCuotaUsd({ moneda: 'USD', cuotaDiv: 25 });
  eq('congela 25 USD a Bs con tasa pago 620 = 15500', Math.round(cuotaUsdUSD * 620), 15500);
  eq('restante divisa (4 cuotas, 1 paga, 25$ c/u) = $75', app._multaRestTxt({ moneda: 'USD', resp: 'chofer', cuotas: 4, cuotasPagas: 1, cuotaDiv: 25 }), '$75');

  console.log('\nmulti-contrato Paso 3 (unidades ↔ contratos):');
  ok('abrirMultiContrato definida', typeof app.abrirMultiContrato === 'function');
  ok('guardarUnidadMC definida', typeof app.guardarUnidadMC === 'function');
  ok('switchMCTab definida', typeof app.switchMCTab === 'function');
  app.CONTRATOS = [{ id: 'CNT1', nombre: 'Alcaldía Maracaibo', estado: 'activo' }];
  eq('_contratoNombre mapea id→nombre (enlace unidad↔contrato)', app._contratoNombre('CNT1'), 'Alcaldía Maracaibo');
  eq('_contratoNombre id desconocido → el id', app._contratoNombre('XX'), 'XX');

  console.log('\nmulti-contrato Paso 4 (operaciones → ingreso/egreso, conversión a USD):');
  ok('guardarOperacionMC definida', typeof app.guardarOperacionMC === 'function');
  app.TASAS.bcvDolar = 617; app.TASAS.bcvEuro = 634;
  eq('contrato USD → monto se queda', app._mcDivAUsd(100, { moneda: 'USD' }), 100);
  eq('contrato Bs → /tasa (61700/617=100)', Math.round(app._mcDivAUsd(61700, { moneda: 'Bs' })), 100);
  eq('contrato EUR → vía euro/dolar', Math.round(app._mcDivAUsd(100, { moneda: 'EUR' })), Math.round(100 * 634 / 617));
  eq('sin contrato (USD por defecto) se queda', app._mcDivAUsd(50, null), 50);
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', fecha: '2026-06-10', monto_cliente: 100, monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', fecha: '2026-07-01', monto_cliente: 200, monto_operador: 80 }
  ];
  eq('filtro por rango incluye solo junio', app._operacionesFiltradas('2026-06-01', '2026-06-30', null).length, 1);
  eq('filtro por contrato trae las 2', app._operacionesFiltradas(null, null, 'CNT1').length, 2);

  console.log('\nmulti-contrato Paso 5/6 (P&L por contrato + consolidado):');
  ok('_pnlPorContrato definida', typeof app._pnlPorContrato === 'function');
  app.CONTRATOS = [{ id: 'CNT1', nombre: 'PDVSA', moneda: 'USD', estado: 'activo' }];
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', fecha: '2026-06-10', monto_cliente: 100, monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', fecha: '2026-06-11', monto_cliente: 50, monto_operador: 20 }
  ];
  var pnl = app._pnlPorContrato('', '');
  eq('agrupa en 1 contrato', pnl.length, 1);
  eq('ingreso sumado (100+50)', pnl[0].ingreso, 150);
  eq('pago operadores sumado (40+20)', pnl[0].pago, 60);
  eq('margen = ingreso − pago', pnl[0].margen, 90);

  console.log('\nmulti-contrato Paso 7 (nómina operadores):');
  ok('_nominaOperadores definida', typeof app._nominaOperadores === 'function');
  app.OPERACIONES = [
    { id: 'O1', contrato_id: 'CNT1', operador: 'JUAN', monto_operador: 40 },
    { id: 'O2', contrato_id: 'CNT1', operador: 'JUAN', monto_operador: 20 },
    { id: 'O3', contrato_id: 'CNT1', operador: 'PEDRO', monto_operador: 30 }
  ];
  var nom = app._nominaOperadores('', '');
  eq('agrupa 2 operadores', nom.length, 2);
  eq('JUAN suma 60 y va primero (mayor pago)', nom[0].operador + '=' + nom[0].pago, 'JUAN=60');

  console.log('\nmulti-contrato: 1 unidad → varios clientes en días distintos (caso venta):');
  app.CONTRATOS = [
    { id: 'CA', nombre: 'PDVSA', moneda: 'USD', forma_cobro: 'viaje', tarifa_cliente: 50, tarifa_operador: 10, estado: 'activo' },
    { id: 'CB', nombre: 'Empresa X', moneda: 'USD', forma_cobro: 'viaje', tarifa_cliente: 80, tarifa_operador: 15, estado: 'activo' }
  ];
  // mismo camión UN1: lunes le trabaja a PDVSA, martes a Empresa X
  app.OPERACIONES = [
    { id: 'OP1', contrato_id: 'CA', unidad_id: 'UN1', fecha: '2026-06-10', operador: 'JUAN', monto_cliente: 150, monto_operador: 30 },
    { id: 'OP2', contrato_id: 'CB', unidad_id: 'UN1', fecha: '2026-06-11', operador: 'JUAN', monto_cliente: 160, monto_operador: 30 }
  ];
  var pm = app._pnlPorContrato('', '');
  eq('P&L separa por cliente (2 filas) aunque sea el mismo camión', pm.length, 2);
  var nm2 = app._nominaOperadores('', '');
  eq('nómina junta al operador entre clientes (JUAN 1 fila)', nm2.length, 1);
  eq('JUAN cobra 60 (30+30) por los 2 clientes', nm2[0].pago, 60);

  console.log('\nnómina: alias de nombres + planilla especial:');
  ok('agregarAlias definida', typeof app.agregarAlias === 'function');
  app._ALIAS_NOMBRES[app._normNom('Alexander Hernandez')] = 'ALEXANDER JOSE HERNANDEZ PEREZ';
  eq('alias resuelve nombre corto → completo (cotejo lo reconoce)', app._nombreCanonico('Alexander Hernandez'), 'ALEXANDER JOSE HERNANDEZ PEREZ');
  ok('guardarPlanillaEspecial definida', typeof app.guardarPlanillaEspecial === 'function');
  app.EMPLEADOS = [{ id: 'E1', nombre: 'JUAN PEREZ', cargo: 'Chofer' }, { id: 'E2', nombre: 'PEDRO LOPEZ', cargo: 'Ayudante', tipoAy: 'interno' }];
  eq('extra monto fijo = el monto', app._extraUsd({ modo: 'monto', monto: 15 }), 15);
  eq('extra viajes chofer (2 × $10)', app._extraUsd({ modo: 'viajes', viajes: 2, empId: 'E1' }), 20);
  eq('extra viajes ayudante (3 × $5)', app._extraUsd({ modo: 'viajes', viajes: 3, empId: 'E2' }), 15);
  app.NOMINA_EXTRAS = [
    { id: 'NE1', fecha: '2026-06-10', empId: 'E1', modo: 'monto', monto: 15 },
    { id: 'NE2', fecha: '2026-07-01', empId: 'E1', modo: 'monto', monto: 20 }
  ];
  eq('extras filtrados por período (solo junio)', app._extrasNominaPeriodo('2026-06-01', '2026-06-30').length, 1);

  console.log('\ninteligencia de flota (#6 disponibilidad + #1 costo):');
  ok('calcDisponibilidadFlota definida', typeof app.calcDisponibilidadFlota === 'function');
  app.FLOTA = { 'JAC-B001': {}, 'JAC-B002': {}, 'JAC-B003': {} };
  app.KM_DATA = { 'JAC-B002': { estado: 'En taller' } };
  var disp = app.calcDisponibilidadFlota();
  eq('total flota JAC', disp.total, 3);
  eq('2 operativas (1 en taller)', disp.operativas, 2);
  eq('67% disponibilidad', disp.pct, 67);
  ok('en riesgo (67% < 80%)', disp.enRiesgo === true);
  app.KM_DATA = {};
  eq('todas operativas → 100%', app.calcDisponibilidadFlota().pct, 100);
  ok('100% no está en riesgo', app.calcDisponibilidadFlota().enRiesgo === false);
  // interconexión: disponibilidad usa la MISMA fuente que el widget (_estadoCamReal), no solo KM_DATA
  ok('_estadoCamReal definida (fuente única)', typeof app._estadoCamReal === 'function');
  app.FLOTA = { 'JAC-B001': {}, 'JAC-B002': { estado: 'taller' }, 'JAC-B003': { estado: 'operativo' }, 'JAC-B004': {} };
  app.KM_DATA = {};
  var d2 = app.calcDisponibilidadFlota();
  eq('cuenta el taller de FLOTA.estado, no solo KM_DATA (3/4 operativas)', d2.operativas, 3);
  ok('el camión en taller aparece en "fuera"', d2.fuera.some(function (x) { return x.cam === 'JAC-B002'; }));
  // #1 flag de costo por viaje sobre el promedio +15%
  ok('calcRentabilidadCamiones definida', typeof app.calcRentabilidadCamiones === 'function');
  app.REGS = [
    { cam: 'JAC-B001', f: '2026-06-10', t: 10, m: 3000 },
    { cam: 'JAC-B002', f: '2026-06-10', t: 10, m: 3000 }
  ];
  app.GASOIL = [];
  var Rr = app.calcRentabilidadCamiones('', '');
  ok('cada fila trae costoViaje', Rr.rows.every(function (r) { return typeof r.costoViaje === 'number'; }));
  ok('cada fila trae el flag sobreCosto', Rr.rows.every(function (r) { return typeof r.sobreCosto === 'boolean'; }));
  ok('avgCostoViaje calculado', typeof Rr.avgCostoViaje === 'number');

  console.log('\ninteligencia de flota (#3 compras + #4 scoring):');
  ok('calcComprasSugeridas definida', typeof app.calcComprasSugeridas === 'function');
  app.FLOTA = { 'JAC-B001': {} };
  app.KM_DATA = { 'JAC-B001': { km: 59800 } }; // a 200 km del próximo servicio (60000)
  app.INVENTARIO = [{ nombre: 'Filtro aceite', stock: 1, stockMin: 3, precio: 10 }, { nombre: 'Correa', stock: 5, stockMin: 2, precio: 20 }];
  app.REGS = [];
  var cs = app.calcComprasSugeridas();
  ok('detecta servicio próximo (faltan ≤1000 km)', cs.servicios.some(function (s) { return s.cam === 'JAC-B001'; }));
  eq('detecta 1 insumo bajo mínimo (filtro)', cs.bajos.length, 1);
  eq('sugiere reponer filtro (min×2 − stock = 5)', cs.bajos[0].sugerido, 5);
  ok('calcScoringChoferes definida', typeof app.calcScoringChoferes === 'function');
  app.EMPLEADOS = [{ id: 'C1', nombre: 'JUAN PEREZ', cargo: 'Chofer', activo: true }];
  app.REGS = [{ cam: 'JAC-B001', f: '2026-06-10', t: 10, ch: 'JUAN PEREZ' }];
  app.MULTAS = [{ resp: 'chofer', choferId: 'C1', fecha: '2026-06-10' }, { resp: 'chofer', choferId: 'C1', fecha: '2026-06-11' }];
  app.GASOIL = [];
  var sc = app.calcScoringChoferes('', '');
  ok('scorea al chofer', sc.rows.length === 1 && sc.rows[0].id === 'C1');
  eq('2 multas → score 100−16 = 84', sc.rows[0].score, 84);

  console.log('\n#5 llantas por mm (estado + costo/mm + rendimiento por marca):');
  ok('_estadoLlMm definida', typeof app._estadoLlMm === 'function');
  eq('mm<3 → Cambiar Urgente', app._estadoLlMm(2), 'Cambiar Urgente');
  eq('mm 4 → Regular', app._estadoLlMm(4), 'Regular');
  eq('mm 8 → Buena', app._estadoLlMm(8), 'Buena');
  eq('costo/mm = precio / mm gastados (300/(14-6)=37.5)', app._llCostoMm({ precio: 300, mmInicial: 14, mm: 6 }), 37.5);
  eq('costo/mm null si falta dato', app._llCostoMm({ precio: 300, mm: 6 }), null);
  app.LLANTAS = {
    'JAC-B001': [
      { posicion: 'DI', marca: 'Goodyear', precio: 300, mmInicial: 14, mm: 6 },   // 300/8 = 37.5
      { posicion: 'DD', marca: 'Pirelli', precio: 200, mmInicial: 14, mm: 4 }     // 200/10 = 20 (rinde más)
    ]
  };
  var rm = app._llRendimientoMarca();
  eq('2 marcas comparadas', rm.length, 2);
  eq('Pirelli rinde más (menor $/mm) va primero', rm[0].marca, 'Pirelli');

  console.log('\n#2 auditoría de insumos (alerta de garantía):');
  ok('_garantiaAlerta definida', typeof app._garantiaAlerta === 'function');
  var hoyG = new Date().toISOString().slice(0, 10);
  app.INV_MOV = [{ tipo: 'Uso', cam: 'JAC-B001', item: 'Alternador', fecha: hoyG }];
  ok('detecta cambio reciente de la misma pieza (¿garantía?)', app._garantiaAlerta('Alternador', 'JAC-B001') !== null);
  eq('otra pieza no alerta', app._garantiaAlerta('Filtro', 'JAC-B001'), null);
  eq('otro camión no alerta', app._garantiaAlerta('Alternador', 'JAC-B002'), null);
  app.INV_MOV = [{ tipo: 'Uso', cam: 'JAC-B001', item: 'Alternador', fecha: '2024-01-01' }];
  eq('cambio viejo (>4 meses) no alerta', app._garantiaAlerta('Alternador', 'JAC-B001'), null);

  console.log('\n#F multa al chofer correcto (_choferDeMulta — fuente única):');
  ok('_choferDeMulta definida', typeof app._choferDeMulta === 'function');
  app.EMPLEADOS = [{ id: 'C1', nombre: 'JUAN', cargo: 'Chofer', unidad: 'JAC-B001' }, { id: 'C2', nombre: 'PEDRO', cargo: 'Chofer', unidad: 'JAC-B009' }];
  eq('usa el choferId REGISTRADO (no el actual del camión)', app._choferDeMulta({ choferId: 'C2', camId: 'JAC-B001' }).id, 'C2');
  eq('sin choferId → cae al chofer del camión', app._choferDeMulta({ camId: 'JAC-B001' }).id, 'C1');

  console.log('\n#B combustible cuenta UNA vez (compra vía CxP, sin doble conteo):');
  ok('_esCxpCombustible definida', typeof app._esCxpCombustible === 'function');
  ok('detecta CxP de compra de combustible', app._esCxpCombustible({ descripcion: 'Compra combustible 100 L @ $0.8/L' }) === true);
  ok('CxP normal NO es de combustible', app._esCxpCombustible({ descripcion: 'Repuesto alternador' }) === false);
  app.REGS = []; app.GASTOS_FIJOS = []; app.GASTOS_VARIABLES = []; app.MULTAS = [];
  app.GASOIL = [{ cam: 'COMPRA · Tumaca', m: 1000, tipo_operacion: 'compra' }, { cam: 'JAC-B001', m: 300 }];
  app.CXP = [{ descripcion: 'Compra combustible 1000 L', neto_pagar: 1000 }, { descripcion: 'Repuesto', neto_pagar: 200 }];
  // Antes: egGas(1000+300) + egCxP(1000+200) = 2500 (combustible 2-3 veces). Ahora: compra 1000 (una vez) + repuesto 200 = 1200.
  eq('combustible una sola vez: 1000 compra + 200 repuesto = 1200 (no 2500)', app._totalEgresos(0), 1200);

  console.log('\n#C patio "manual manda" (sin doble pago):');
  ok('_patioEfectivo definida', typeof app._patioEfectivo === 'function');
  eq('manual cargado manda (manual=2, asistencia=3 → 2)', app._patioEfectivo(3, 2), 2);
  eq('sin manual usa asistencia (manual=0, asistencia=3 → 3)', app._patioEfectivo(3, 0), 3);
  eq('ninguno → 0', app._patioEfectivo(0, 0), 0);
  // ayudante: a.viajes ya trae el patio de asistencia (a.patio). Con manual debe NO duplicar.
  app.PATIO_DIAS = { 'E9': 2 };
  var vpa = app._ayPatio({ viajes: 12, patio: 3, emp: { id: 'E9', tipoAy: 'interno' } }); // 12 incluye 3 de asistencia; manual=2 manda
  eq('ayudante: viajes efectivos = (12-3)+2 = 11 (no 12+2=14)', vpa.viajes, 11);
  eq('ayudante: patio efectivo = 2 (manual)', vpa.patio, 2);

  console.log('\n#A CXP normalizada (sin $NaN, pagado=pagada):');
  ok('_normCxpRow definida', typeof app._normCxpRow === 'function');
  var cxRaw = { id: 'CX1', neto_pagar: 500, base_usd: 430, total_usd: 500, estado: 'pendiente', prov_nombre: 'Tumaca' };
  var cn = app._normCxpRow(cxRaw);
  eq('fila cruda snake_case → también trae netoPagar (legacy no ve NaN)', cn.netoPagar, 500);
  eq('conserva neto_pagar (módulo nuevo)', cn.neto_pagar, 500);
  eq('prov en ambos nombres', cn.prov, 'Tumaca');
  ok('_cxpPagada acepta pagada y pagado', app._cxpPagada({ estado: 'pagada' }) === true && app._cxpPagada({ estado: 'pagado' }) === true);
  ok('_cxpPagada false en pendiente', app._cxpPagada({ estado: 'pendiente' }) === false);

  console.log('\n#K matching alias-aware (_empPorNombre no marca "no identificado" a quien la nómina paga):');
  app.EMPLEADOS = [{ id: 'E1', nombre: 'YIRBER LENITHON GONZALEZ MONTIEL', cargo: 'Chofer' }];
  app._ALIAS_NOMBRES[app._normNom('Yiber Gonzalez')] = 'YIRBER LENITHON GONZALEZ MONTIEL';
  var emA = app._empPorNombre('Yiber Gonzalez');
  ok('_empPorNombre resuelve por alias (corto→empleado completo)', emA && emA.id === 'E1');

  console.log('\n#J caja chica (saldo desde la última reposición, sin borrar gastos del período):');
  ok('calcSaldoCaja definida', typeof app.calcSaldoCaja === 'function');
  app.TASAS.bcvDolar = 100;
  app.CAJACHICA = {
    montoFijo: 150,
    reposiciones: [{ fecha: '2026-06-01', tasa: 100, montoBs: 15000, montoUsd: 150 }],
    gastos: [
      { fecha: '2026-05-20', concepto: 'viejo (otro período)', montoBs: 9000, factura: 'no' }, // antes de la reposición → NO cuenta
      { fecha: '2026-06-10', concepto: 'gasto1', montoBs: 4000, factura: 'si' },
      { fecha: '2026-06-12', concepto: 'gasto2', montoBs: 1000, factura: 'no' }
    ]
  };
  var sc2 = app.calcSaldoCaja();
  eq('saldo = 15000 − (4000+1000) del período, ignora el viejo = 10000', sc2.saldoBs, 10000);
  eq('saldo USD = 10000/100 = 100', sc2.saldoUsd, 100);

  console.log('\n#1 planilla especial: mes de la fecha (mismo formato que las planillas):');
  ok('_mesDeF definida', typeof app._mesDeF === 'function');
  eq('_mesDeF jun-26', app._mesDeF('2026-06-30'), 'jun-26');
  eq('_mesDeF ene-26', app._mesDeF('2026-01-05'), 'ene-26');
  eq('_mesDeF dic-25', app._mesDeF('2025-12-15'), 'dic-25');

  console.log('\n#2 cotejo: 3 estados (OK / planilla en otra fecha / sin planilla en el sistema):');
  ok('_audConstruir definida', typeof app._audConstruir === 'function');
  app.cfg = { chofer: 10, ayud: 5, imau: 2.5, tarifa: 317.88 };
  app.EMPLEADOS = [];
  app.TEMPORALES = {};
  app.REGS = [
    { cam: 'JAC-B001', f: '2026-06-10', t: 10, ch: 'JUAN PEREZ' },   // dentro del rango de la semana
    { cam: 'JAC-B002', f: '2026-01-05', t: 8, ch: 'PEDRO OTRA' }     // SÍ tiene planilla, pero FUERA del rango
  ];
  var hAud = {
    semana: 'SEM-X', fecha_desde: '2026-06-08', fecha_hasta: '2026-06-14',
    detalle: { choferes: [
      { n: 'JUAN PEREZ', usd: 100, pat: 0 },  // 10 viajes × $10 = $100 → cuadra
      { n: 'PEDRO OTRA', usd: 50, pat: 0 },   // planilla en otra fecha → a revisar, NO infla el $
      { n: 'EX CHOFER',  usd: 40, pat: 0 }    // sin planilla en ningún lado → informativo
    ], ayudantes: [], extras: [] }
  };
  var agA = app._audConstruir(hAud, false);
  function _filaDe(n){ return agA.filas.find(function(x){ return x.n === n; }); }
  eq('JUAN (cuadra) flag vacío', _filaDe('JUAN PEREZ').flag, '');
  eq('PEDRO → OTRA_FECHA (tiene planilla pero fuera de rango)', _filaDe('PEDRO OTRA').flag, 'OTRA_FECHA');
  eq('EX CHOFER → SIN_SISTEMA (no hay planilla suya)', _filaDe('EX CHOFER').flag, 'SIN_SISTEMA');
  eq('nSin cuenta solo el ex-chofer', agA.nSin, 1);
  eq('sumOver NO se infla con pagos sin planilla', agA.sumOver, 0);
  eq('nFlag cuenta el OTRA_FECHA a revisar', agA.nFlag, 1);
  var agSinRango = app._audConstruir({ semana: 'SEM-VIEJA', detalle: { choferes: [], ayudantes: [], extras: [] } }, false);
  ok('sinRango=true cuando el historial no tiene fecha_desde/hasta', agSinRango.sinRango === true);

  // #C matching de choferes robusto a espacios dobles / acentos (_normNom en ambos lados):
  // planilla "JOSE  ELITE" (doble espacio, viene del nombre del empleado) vs historial "JOSE ELITE" (un espacio)
  app.EMPLEADOS = [];
  app.REGS = [{ cam: 'JAC-B005', f: '2026-06-10', t: 9, ch: 'JOSE  ELITE ARANGUREN GONZALEZ' }];
  var hC = {
    semana: 'SEM-Y', fecha_desde: '2026-06-08', fecha_hasta: '2026-06-14',
    detalle: { choferes: [{ n: 'JOSE ELITE ARANGUREN GONZALEZ', usd: 90, pat: 0 }], ayudantes: [], extras: [] }
  };
  var agC = app._audConstruir(hC, false);
  var fJose = agC.filas.find(function (x) { return /ARANGUREN/.test(x.n); });
  eq('chofer con doble espacio SÍ se reconoce (9 viajes)', fJose.vj, 9);
  ok('no lo marca "sin planilla en el sistema"', fJose.flag !== 'SIN_SISTEMA');
  eq('cuadra: corr 90 = pag 90, diff 0', fJose.diff, 0);

  console.log('\ndd/mm/yyyy en todo el software (formatFecha / fmtFechaHora / fmtFechaDow):');
  ok('formatFecha definida', typeof app.formatFecha === 'function');
  eq('formatFecha YYYY-MM-DD → dd/mm/yyyy', app.formatFecha('2026-06-07'), '07/06/2026');
  eq('formatFecha con hora (slice) → dd/mm/yyyy', app.formatFecha('2026-06-07T12:00:00'), '07/06/2026');
  eq('formatFecha Date → dd/mm/yyyy', app.formatFecha(new Date(2026, 5, 7)), '07/06/2026');
  eq('formatFecha ya formateado se respeta', app.formatFecha('07/06/2026'), '07/06/2026');
  eq('formatFecha vacío → ""', app.formatFecha(''), '');
  ok('fmtFechaHora definida', typeof app.fmtFechaHora === 'function');
  eq('fmtFechaHora → dd/mm/yyyy HH:MM', app.fmtFechaHora(new Date(2026, 5, 7, 9, 5)), '07/06/2026 09:05');
  ok('fmtFechaDow definida', typeof app.fmtFechaDow === 'function');
  eq('fmtFechaDow → día + dd/mm/yyyy', app.fmtFechaDow(new Date(2026, 5, 7)), 'domingo 07/06/2026');

  console.log('\nMantenimiento — Hoja de vida (fuente única + catálogo por tipo):');
  ok('_seedMantItemsDefault definida', typeof app._seedMantItemsDefault === 'function');
  var _seed = app._seedMantItemsDefault();
  ok('catálogo trae batería y filtro trampa', _seed.some(function (x) { return x.id === 'bateria'; }) && _seed.some(function (x) { return x.id === 'filtro_trampa'; }));
  app.MANT_ITEMS = _seed; app.UNIDAD_CONFIG = {};
  var itsAll = app._hvItemsDeUnidad('JAC-B001');
  ok('unidad sin tipo NO hereda el ítem diésel (filtro trampa)', !itsAll.some(function (x) { return x.id === 'filtro_trampa'; }));
  app.UNIDAD_CONFIG = { 'JAC-B001': { tipo: 'diesel' } };
  ok('unidad diésel SÍ hereda el filtro trampa', app._hvItemsDeUnidad('JAC-B001').some(function (x) { return x.id === 'filtro_trampa'; }));
  // Herencia por COMBUSTIBLE (no por tipo): un Camión diésel hereda el filtro trampa; uno gasolina no.
  app.UNIDAD_CONFIG = { 'JAC-B001': { tipo: 'Camión', combustible: 'diesel' } };
  ok('camión diésel hereda el filtro trampa (por combustible)', app._hvItemsDeUnidad('JAC-B001').some(function (x) { return x.id === 'filtro_trampa'; }));
  app.UNIDAD_CONFIG = { 'JAC-B001': { tipo: 'Camión', combustible: 'gasolina' } };
  ok('camión gasolina NO hereda el filtro trampa', !app._hvItemsDeUnidad('JAC-B001').some(function (x) { return x.id === 'filtro_trampa'; }));
  app.MANTENIMIENTOS = [
    { id: 'm1', cam: 'JAC-B001', fecha: '2026-01-10', km: 1000, itemId: 'bateria' },
    { id: 'm2', cam: 'JAC-B001', fecha: '2026-06-01', km: 8000, itemId: 'bateria' },
    { id: 'm3', cam: 'JAC-B002', fecha: '2026-06-15', km: 5000, itemId: 'bateria' }
  ];
  eq('_ultimoMantItem devuelve el más reciente (por fecha)', app._ultimoMantItem('JAC-B001', 'bateria').fecha, '2026-06-01');
  eq('_ultimoMantItem respeta la unidad', app._ultimoMantItem('JAC-B002', 'bateria').km, 5000);
  ok('_ultimoMantItem null si no hay registro', app._ultimoMantItem('JAC-B999', 'bateria') === null);
  eq('_mantItem resuelve por id', app._mantItem('bateria').nombre, 'Batería');

  console.log('\nMantenimiento preventivo (motor puro _mantEstadoCalc):');
  ok('_mantEstadoCalc definida', typeof app._mantEstadoCalc === 'function');
  // Por KM: intervalo 5000, último a 1000 km → vence a 6000. Km actual 6200 → vencido.
  eq('km vencido', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 6200, '2026-06-30').estado, 'vencido');
  // Km actual 5600 → restan 400 ≤ aviso 500 → próximo.
  eq('km próximo (dentro del aviso)', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 5600, '2026-06-30').estado, 'proximo');
  // Km actual 3000 → restan 3000 → al día.
  eq('km al día', app._mantEstadoCalc('km', 5000, 500, { km: 1000, fecha: '2026-01-01' }, 3000, '2026-06-30').estado, 'al_dia');
  // Por MESES: batería 12 meses desde 2025-01-01 → vence 2025-12-27 aprox → hoy 2026-06-30 → vencido.
  eq('tiempo vencido (batería 12m)', app._mantEstadoCalc('meses', 12, 15, { km: 0, fecha: '2025-01-01' }, 0, '2026-06-30').estado, 'vencido');
  // Por DÍAS: filtro trampa cada 2 días desde 2026-06-29 → vence 07-01 → hoy 06-30 → resta 1 día ≤ aviso 0? no (1>0) → al día... usar aviso 2 → próximo.
  eq('días próximo (aviso cubre)', app._mantEstadoCalc('dias', 2, 2, { km: 0, fecha: '2026-06-29' }, 0, '2026-06-30').estado, 'proximo');
  // SIN REGISTRO: la regla cambió y este test se quedó atrás (por eso `npm test` venía fallando y,
  // peor, cortaba la cadena `&&`: las pruebas de nómina que van después NO llegaban a correr).
  // Regla vigente (Máximo, documentada en `_mantEstadoCalc`): en km/horas, si nunca se hizo el
  // servicio, el primero vence al LLEGAR al intervalo — se cuenta desde 0. La unidad va en 9.000 km
  // con intervalo de 5.000 y sin un solo registro: eso es VENCIDO, no "no sé". El vencimiento solo
  // se quita registrando el servicio.
  eq('sin registro y ya pasó el intervalo → vencido', app._mantEstadoCalc('km', 5000, 500, null, 9000, '2026-06-30').estado, 'vencido');
  eq('sin registro y todavía no llega al intervalo → al día', app._mantEstadoCalc('km', 5000, 500, null, 1200, '2026-06-30').estado, 'al_dia');
  // En base TIEMPO sí queda en sin_dato: no hay fecha desde la cual contar. Ahí "no sé" es la verdad.
  eq('sin registro en base tiempo → sin_dato', app._mantEstadoCalc('meses', 12, 15, null, 0, '2026-06-30').estado, 'sin_dato');
  eq('sin intervalo → sin_intervalo', app._mantEstadoCalc('km', 0, 0, { km: 0, fecha: '2026-01-01' }, 100, '2026-06-30').estado, 'sin_intervalo');

  console.log('\nRegistro de Unidades (ficha = fuente única para otros módulos):');
  ok('unidadInfo definida', typeof app.unidadInfo === 'function');
  app.UNIDAD_CONFIG = { 'JAC-B001': { placa: 'AB123CD', vin: 'VIN123', tipo: 'camion' } };
  eq('unidadInfo trae la placa de la ficha', app.unidadInfo('JAC-B001').placa, 'AB123CD');
  eq('unidadInfo trae el VIN de la ficha', app.unidadInfo('JAC-B001').vin, 'VIN123');
  eq('unidadInfo vacío si la unidad no existe', JSON.stringify(app.unidadInfo('NADA')), '{}');

  console.log('\nPreventivo v2 (base horas · doble intervalo · plantilla por combinación):');
  eq('horas vencido', app._mantEstadoCalc('horas', 250, 25, { horas: 100 }, 400, '2026-06-30').estado, 'vencido');
  eq('horas al día', app._mantEstadoCalc('horas', 250, 25, { horas: 100 }, 300, '2026-06-30').estado, 'al_dia');
  eq('km sin lectura (unidad por tiempo) → sin_medida', app._mantEstadoCalc('km', 5000, 500, { km: 0 }, null, '2026-06-30').estado, 'sin_medida');
  // Plantilla por combinación: la unidad hereda SOLO la de su tipo+combustible.
  app.MANT_ITEMS = [
    { id: 'a', nombre: 'Aceite', base: 'km', inspeccion: 5000, sustitucion: 10000, avisoAnticipo: 500, tipo: 'Pickup', combustible: 'diesel', activo: true },
    { id: 'b', nombre: 'Aceite', base: 'km', inspeccion: 5000, sustitucion: 15000, avisoAnticipo: 500, tipo: 'Camión', combustible: 'diesel', activo: true }
  ];
  app.UNIDAD_CONFIG = { 'U1': { tipo: 'Pickup', combustible: 'diesel' } };
  eq('unidad hereda solo su combinación (1 ítem)', app._itemsPlantilla('U1').length, 1);
  eq('hereda el de su tipo (Pickup)', app._itemsPlantilla('U1')[0].tipo, 'Pickup');
  app.UNIDAD_CONFIG = { 'U1': { tipo: 'Pickup', combustible: 'gasolina' } };
  eq('otra combinación (gasolina) NO hereda el de diésel', app._itemsPlantilla('U1').length, 0);
  // Doble intervalo end-to-end: inspección vencida, cambio al día.
  app.REGS = []; app.CHECKLIST_DATA = []; app.KM_DATA = { 'U1': { km: 6000 } };
  app.UNIDAD_CONFIG = { 'U1': { tipo: 'Pickup', combustible: 'diesel' } };
  app.MANT_ITEMS = [{ id: 'a', nombre: 'Aceite', base: 'km', inspeccion: 5000, sustitucion: 10000, avisoAnticipo: 500, tipo: 'Pickup', combustible: 'diesel', activo: true }];
  app.MANTENIMIENTOS = [{ id: 'm1', cam: 'U1', itemId: 'a', fecha: '2026-01-01', km: 1000, tipoTrabajo: 'cambio' }];
  var eDob = app._mantEstado('U1', app.MANT_ITEMS[0]);
  ok('doble intervalo: calcula inspección y cambio', !!(eDob.insp && eDob.cambio));
  eq('inspección vencida (1000+5000=6000, km 6000)', eDob.insp.estado, 'vencido');
  eq('cambio al día (1000+10000=11000)', eDob.cambio.estado, 'al_dia');
  // ── UN SOLO INTERVALO: el «Próximo» se ancla en el ÚLTIMO evento, sea cual sea su tipo ──
  // Casos REALES reportados por Alejandra el 01/09/2026. Antes del arreglo el motor buscaba el
  // último evento con tipoTrabajo='cambio' aunque el ítem no tuviera ciclo de inspección propio:
  // el plan se quedaba clavado en un evento viejo y no avanzaba nunca al registrar el servicio.
  // ⚠️ Estos dos casos FALLAN con el código anterior — es lo que los hace un control y no un adorno.
  console.log('\nPreventivo con un solo intervalo (reporte Alejandra 01/09/2026):');
  app.REGS = []; app.CHECKLIST_DATA = []; app.KM_DATA = {}; app.VIAJES_CHOFER = [];
  app.UNIDAD_CONFIG = { 'JAC-B011': { medida: 'tiempo' } };
  app.MANT_ITEMS = [{ id: 'engrase', nombre: 'Engrase', base: 'dias', intervalo: 15, inspeccion: 0, sustitucion: 0, avisoAnticipo: 0, activo: true }];
  app.MANTENIMIENTOS = [
    { id: 'e1', cam: 'JAC-B011', itemId: 'engrase', fecha: '2026-04-15', km: 4388, tipoTrabajo: 'cambio' },
    { id: 'e2', cam: 'JAC-B011', itemId: 'engrase', fecha: '2026-07-19', km: 14321, tipoTrabajo: 'correctivo' },
    { id: 'e3', cam: 'JAC-B011', itemId: 'engrase', fecha: '2026-08-23', km: 18608, tipoTrabajo: 'correctivo' }
  ];
  var eB011 = app._mantEstado('JAC-B011', app.MANT_ITEMS[0]);
  eq('B011 engrase: «Última vez» es el 23/08', eB011.ultimo.fecha, '2026-08-23');
  eq('B011 engrase: «Próximo» = 23/08 + 15d (la pantalla mostraba 30/04/2026)', eB011.venc, '2026-09-07');
  app.UNIDAD_CONFIG = { 'JAC-B002': { medida: 'km' } };
  app.KM_DATA = { 'JAC-B002': { km: 17314 } };
  app.MANT_ITEMS = [{ id: 'aceite_motor', nombre: 'Aceite de motor', base: 'km', intervalo: 5000, inspeccion: 0, sustitucion: 0, avisoAnticipo: 500, activo: true }];
  app.MANTENIMIENTOS = [
    { id: 'a1', cam: 'JAC-B002', itemId: 'aceite_motor', fecha: '2026-07-08', km: 12260, tipoTrabajo: 'cambio' },
    { id: 'a2', cam: 'JAC-B002', itemId: 'aceite_motor', fecha: '2026-08-05', km: 15433, tipoTrabajo: 'correctivo' }
  ];
  var eB002 = app._mantEstado('JAC-B002', app.MANT_ITEMS[0]);
  eq('B002 aceite: «Próximo» = 15.433 + 5.000 (la pantalla mostraba 17.260)', eB002.venc, 20433);
  // CONTROL NEGATIVO: con doble ciclo (inspección Y sustitución) el cambio SIGUE anclado en el
  // último 'cambio'. Sin esto, el arreglo de arriba pasaría también con el filtro borrado de raíz.
  app.KM_DATA = { 'U9': { km: 13000 } }; app.UNIDAD_CONFIG = { 'U9': { medida: 'km' } };
  app.MANT_ITEMS = [{ id: 'c', nombre: 'Caucho', base: 'km', inspeccion: 5000, sustitucion: 60000, avisoAnticipo: 500, activo: true }];
  app.MANTENIMIENTOS = [
    { id: 'c1', cam: 'U9', itemId: 'c', fecha: '2026-01-01', km: 1000, tipoTrabajo: 'cambio' },
    { id: 'c2', cam: 'U9', itemId: 'c', fecha: '2026-08-01', km: 12000, tipoTrabajo: 'reparacion' }
  ];
  var eU9 = app._mantEstado('U9', app.MANT_ITEMS[0]);
  eq('doble ciclo: reparar NO renueva la vida del caucho (1.000+60.000)', eU9.cambio.venc, 61000);
  eq('doble ciclo: la inspección sí cuenta desde el último evento (12.000+5.000)', eU9.insp.venc, 17000);

  // ── EL CICLO DE LAVADO/ENGRASE SALE DEL CATÁLOGO, NO DE UN NÚMERO CLAVADO ──
  // Máximo, 01/09/2026: «el lavado de Betangar es cada 45 días sin duda, pero cada empresa es
  // diferente». Antes el panel de Lavados tenía 45 escrito en el código y Preventivo leía los 7
  // de la semilla del catálogo: dos verdades en la misma pantalla, y las 12 unidades VENCIDAS.
  console.log("\n" + 'Ciclo de lavado/engrase desde el catálogo:');
  app.MANT_ITEMS = [{ id: 'lavado', nombre: 'Lavado', base: 'dias', intervalo: 45, avisoAnticipo: 10, activo: true }];
  eq('Betangar: lavado 45 días, avisa 10 antes', app._cicloItem('lavado', 45, 10), { iv: 45, av: 10, aviso: 35 });
  app.MANT_ITEMS = [{ id: 'lavado', nombre: 'Lavado', base: 'dias', intervalo: 20, avisoAnticipo: 3, activo: true }];
  eq('OTRA empresa con 20 días manda sobre el 45 de reserva', app._cicloItem('lavado', 45, 10), { iv: 20, av: 3, aviso: 17 });
  app.MANT_ITEMS = [{ id: 'lavado', nombre: 'Lavado', base: 'dias', intervalo: 30, avisoAnticipo: 0, activo: true }];
  eq('sin aviso declarado, se conserva el de reserva', app._cicloItem('lavado', 45, 10), { iv: 30, av: 10, aviso: 20 });
  // CONTROL: sin catálogo cargado no se rompe ni inventa — usa lo que el panel ya usaba.
  app.MANT_ITEMS = [];
  eq('catálogo vacío → reserva 45/10 (lo de antes)', app._cicloItem('lavado', 45, 10), { iv: 45, av: 10, aviso: 35 });
  eq('catálogo vacío → engrase 15/5 (lo de antes)', app._cicloItem('engrase', 15, 5), { iv: 15, av: 5, aviso: 10 });

  // medida por unidad + horas
  app.UNIDAD_CONFIG = { 'U1': { medida: 'horas', horasActuales: 340 } };
  eq('medidaUnidad explícita = horas', app.medidaUnidad('U1'), 'horas');
  eq('horasActualUnidad = 340', app.horasActualUnidad('U1'), 340);
  // Flag "Unidad Parada"
  app.KM_DATA = { 'P1': { f: '2020-01-01' } }; app.REGS = []; app.VIAJES_CHOFER = [];
  ok('parada: sin rodar hace años → true', app._unidadParada('P1').parada === true);
  app.KM_DATA = {}; app.REGS = []; app.VIAJES_CHOFER = [];
  ok('sin datos de movimiento → no marcada parada', app._unidadParada('P9').parada === false);

  // ── Semana secuencial SEM-N (ancla SEM-16 = lunes 15/06/2026) ──
  console.log('\nSemana secuencial (SEM-N):');
  eq('15/06/2026 (lunes) → SEM-16', app._semDeFecha('2026-06-15').label, 'SEM-16');
  eq('21/06/2026 (domingo, misma semana) → SEM-16', app._semDeFecha('2026-06-21').label, 'SEM-16');
  eq('08/06/2026 → SEM-15', app._semDeFecha('2026-06-08').label, 'SEM-15');
  eq('22/06/2026 → SEM-17', app._semDeFecha('2026-06-22').label, 'SEM-17');
  eq('01/06/2026 → SEM-14', app._semDeFecha('2026-06-01').label, 'SEM-14');
  eq('período legible', app._semDeFecha('2026-06-15').periodo, 'Del 15 de junio al 21 de junio de 2026');
  ok('sin fecha → null', app._semDeFecha('') === null);

  // ── SEMANA DEL MES = semana REAL lunes–domingo (asistencia, nómina, cobranza) ──
  // Caso real 2026-07-28: el fichaje arrancó el 22/07 y TODO (22 al 28) se veía en "Semana 4",
  // con la "Semana 5" vacía. Causa: la semana era un bloque de días del mes (22-28), que empieza
  // miércoles → su "lunes" era el 27. Y el bloque 29-31 no tiene lunes ni martes: imposible de
  // llenar. Los CONTROLES de abajo son justo los casos que fallaban.
  console.log('\nSemana del mes (lunes–domingo real):');
  eq('mié 01/07/2026 → Semana 1 (la semana del día 1)', app.getSem('2026-07-01'), 'Semana 1');
  eq('dom 19/07/2026 → Semana 3', app.getSem('2026-07-19'), 'Semana 3');
  eq('lun 20/07/2026 → Semana 4 (el Excel dice "20/07 al 26/07")', app.getSem('2026-07-20'), 'Semana 4');
  eq('CONTROL: mar 21/07/2026 → Semana 4 (por bloque daba Semana 3)', app.getSem('2026-07-21'), 'Semana 4');
  eq('dom 26/07/2026 → Semana 4 (cierra la semana)', app.getSem('2026-07-26'), 'Semana 4');
  eq('CONTROL: lun 27/07/2026 → Semana 5 (por bloque daba Semana 4)', app.getSem('2026-07-27'), 'Semana 5');
  eq('CONTROL: mar 28/07/2026 → Semana 5 (por bloque daba Semana 4)', app.getSem('2026-07-28'), 'Semana 5');
  eq('julio 2026 tiene 5 semanas', app._semanasDeMes('jul-26'), 5);
  eq('agosto 2026 tiene 6 semanas (el selector fijo de 5 perdía una)', app._semanasDeMes('ago-26'), 6);

  console.log('\nFecha real de cada celda del tablero de asistencia:');
  eq('Semana 4 · Lunes → 20/07', app._fechaDeCelda('jul-26', 'Semana 4', 0), '2026-07-20');
  eq('Semana 4 · Miércoles → 22/07 (primer día de fichaje)', app._fechaDeCelda('jul-26', 'Semana 4', 2), '2026-07-22');
  eq('Semana 4 · Jueves → 23/07', app._fechaDeCelda('jul-26', 'Semana 4', 3), '2026-07-23');
  eq('Semana 4 · Domingo → 26/07', app._fechaDeCelda('jul-26', 'Semana 4', 6), '2026-07-26');
  eq('CONTROL: Semana 5 · Lunes → 27/07 (antes: 22/07)', app._fechaDeCelda('jul-26', 'Semana 5', 0), '2026-07-27');
  eq('CONTROL: Semana 5 · Martes → 28/07 (antes: null, celda imposible)', app._fechaDeCelda('jul-26', 'Semana 5', 1), '2026-07-28');
  eq('Semana 1 · Lunes cae FUERA del mes (29/06) y está bien', app._fechaDeCelda('jul-26', 'Semana 1', 0), '2026-06-29');

  console.log('\nFichaje real → celda del tablero (asistencia_dia):');
  app.FICHAJES_SET = new Set(['E999|2026-07-27', 'E999|2026-07-28', 'E999|2026-07-23']);
  app.ASISTENCIA = {};
  app.EMPLEADOS = [{ id: 'E999', nombre: 'PRUEBA', activo: true }];
  eq('fichaje del jue 23 aparece en Semana 4 · Jueves', app._asisMarca('E999', 'jul-26', 'Semana 4', 3), 'P');
  eq('CONTROL: el del lun 27 aparece en Semana 5 · Lunes', app._asisMarca('E999', 'jul-26', 'Semana 5', 0), 'P');
  eq('CONTROL: el del mar 28 aparece en Semana 5 · Martes', app._asisMarca('E999', 'jul-26', 'Semana 5', 1), 'P');
  ok('CONTROL: y NO se cuela en Semana 4 · Lunes (20/07, sin fichaje)',
    app._asisMarca('E999', 'jul-26', 'Semana 4', 0) !== 'P');
  eq('el rango del selector se escribe dd/mm (Venezuela)', app._rangoSemana('jul-26', 4), '20/07 al 26/07');

  // ── IMPORTADOR: columna VERTEDERO (de ella depende el 1.5× nocturno en Resimara) ──
  // Historia: la columna se leía por LETRA FIJA ('U'). En el Excel real la U es "SUG. CHOFER" y la
  // columna VERTEDERO había quedado en la W → todo entraba como La Concepción, en silencio, y el
  // 1.5× no se pagó nunca (1.234 planillas, 0 Resimara en la base al 2026-07-28). Ahora se busca
  // por ENCABEZADO. Estas pruebas incluyen los CONTROLES que fallan si alguien vuelve a la letra fija.
  console.log('\nImportador Excel — columna VERTEDERO (1.5× nocturno Resimara):');
  (function () {
    // Hoja falsa con la MISMA forma que el Excel de Betangar: encabezados en la fila 20,
    // datos desde la 21. `cols` dice en qué letra va el encabezado VERTEDERO (o null = no está).
    function hoja(colVert, valores) {
      var ws = {
        '!ref': 'A20:AC30',
        C20: { v: 'FECHA' }, E20: { v: 'ID_CAMION' }, G20: { v: 'CHOFER' },
        J20: { v: 'VIAJES DIURNOS' }, K20: { v: 'VIAJES NOCTURNOS' },
        P20: { v: 'CORRELATIVO PLANILLAS' }, T20: { v: 'OBSERVACIONES' },
        U20: { v: 'SUG. CHOFER (unidad)' }, V20: { v: 'SUG. AYUDANTE (unidad)' }
      };
      if (colVert) ws[colVert + '20'] = { v: 'VERTEDERO' };
      // 2 planillas: fila 21 (con nocturnos) y fila 22
      ws.C21 = { v: '2026-07-25' }; ws.E21 = { v: 'JAC-B001' }; ws.G21 = { v: 'PEDRO PEREZ' };
      ws.J21 = { v: 1 }; ws.K21 = { v: 2 }; ws.P21 = { v: 9001 };
      ws.C22 = { v: '2026-07-25' }; ws.E22 = { v: 'JAC-B002' }; ws.G22 = { v: 'JUAN LOPEZ' };
      ws.J22 = { v: 3 }; ws.K22 = { v: 0 }; ws.P22 = { v: 9002 };
      Object.keys(valores || {}).forEach(function (k) { ws[k] = { v: valores[k] }; });
      return ws;
    }
    function importar(ws) {
      app.REGS = []; app.VX = {}; app.EMPLEADOS = []; app.DB_READY = false; app.DEMO_MODE = true;
      app.cfg = { tarifa: 317.88 };
      app.XLSX = { utils: { decode_range: function (r) {
        var m = String(r).match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
        return { s: { r: +m[2] - 1, c: 0 }, e: { r: +m[4] - 1, c: 28 } };
      } } };
      var res = app.procesarExcelBetangar({ Sheets: { 'REGISTRO VIAJES': ws } });
      return { res: res, regs: app.REGS };
    }

    var r = importar(hoja('W', { W21: 'Resimara' }));
    eq('encuentra VERTEDERO por encabezado (W)', r.res.colVertedero, 'W');
    eq('la planilla marcada entra como Resimara', (r.regs[0] || {}).vertedero, 'Resimara');
    eq('la no marcada queda en La Concepción', (r.regs[1] || {}).vertedero, 'La Concepción');
    eq('cuenta las Resimara del import', r.res.resimara, 1);
    r = importar(hoja('W', { W21: 'RESIMARA ' }));
    eq('tolera mayúsculas y espacios', (r.regs[0] || {}).vertedero, 'Resimara');

    // CONTROL 1 — la columna se corre de lugar: por letra fija esto FALLA, por encabezado no.
    r = importar(hoja('Y', { Y21: 'Resimara' }));
    eq('CONTROL: columna corrida a la Y → la encuentra igual', r.res.colVertedero, 'Y');
    eq('CONTROL: y lee el dato de la Y', (r.regs[0] || {}).vertedero, 'Resimara');

    // CONTROL 2 — la U es "SUG. CHOFER": un chofer apellidado Resimara NO puede pagar 1.5×.
    r = importar(hoja('W', { U21: 'RESIMARA' }));
    eq('CONTROL: un nombre "RESIMARA" en la U no convierte el viaje', (r.regs[0] || {}).vertedero, 'La Concepción');

    // CONTROL 3 — Excel viejo (sin la columna): tiene que AVISAR, no callarse.
    r = importar(hoja(null, {}));
    eq('CONTROL: sin la columna, avisa (colVertedero vacío)', r.res.colVertedero, '');
    eq('CONTROL: sin la columna, no inventa Resimara', r.res.resimara, 0);

    // ── FECHA VENEZOLANA dd/mm/yyyy (nunca mm/dd) ──
    // El caso que fallaba en silencio: los días 1 al 12, donde las dos lecturas son válidas.
    console.log('\nFecha del Excel en formato venezolano (dd/mm/yyyy):');
    r = importar(hoja('W', { C21: '04/03/2026' }));
    eq('CONTROL: "04/03/2026" es 4 de MARZO (antes entraba 3 de abril)', (r.regs[0] || {}).f, '2026-03-04');
    eq('y el mes queda en marzo', (r.regs[0] || {}).mes, 'mar-26');
    r = importar(hoja('W', { C21: '25/07/2026' }));
    eq('"25/07/2026" → 25 de julio', (r.regs[0] || {}).f, '2026-07-25');
    r = importar(hoja('W', { C21: '2026-07-25' }));
    eq('ISO yyyy-mm-dd se respeta', (r.regs[0] || {}).f, '2026-07-25');
    r = importar(hoja('W', { C21: '07/25/2026' }));
    eq('salvavidas: si el "mes" es 25, era orden gringo → 25 de julio', (r.regs[0] || {}).f, '2026-07-25');
  })();

  // ── BUSCADOR DE ÓRDENES: el número se dicta por los últimos dígitos ──
  // Con el papel en la mano nadie lee "OS-2026-0007" completo: dice "la siete".
  console.log('\nBuscador de órdenes de servicio:');
  (function () {
    const oNueva = { id: 'OS-2026-0007', cams: ['JAC-B005'], proveedor: 'HUMBERTO PACCINI (ATLAS)', item: 'REPARACION DE CAUCHO', notas: '', tipo: 'correctivo', estado: 'emitida' };
    const oVieja = { id: 'OS1785416697067', cams: ['JAC-B011'], proveedor: 'INCONSUMCA', item: 'trabajo de electricidad', notas: '', tipo: 'correctivo', estado: 'hecha' };
    ok('sin búsqueda entra todo', app._osCoincide(oNueva, '') === true);
    ok('número completo', app._osCoincide(oNueva, 'OS-2026-0007') === true);
    ok('últimos dígitos: "7"', app._osCoincide(oNueva, '7') === true);
    ok('últimos dígitos: "0007"', app._osCoincide(oNueva, '0007') === true);
    ok('la vieja larga por su cola: "697067"', app._osCoincide(oVieja, '697067') === true);
    ok('la vieja larga completa', app._osCoincide(oVieja, 'OS1785416697067') === true);
    ok('por proveedor', app._osCoincide(oNueva, 'paccini') === true);
    ok('por lo que se hizo', app._osCoincide(oVieja, 'electricidad') === true);
    ok('por unidad (B005)', app._osCoincide(oNueva, 'b005') === true);
    ok('por unidad (5)', app._osCoincide(oNueva, '5') === true);
    ok('CONTROL: no trae la que no es', app._osCoincide(oNueva, 'electricidad') === false);
    ok('CONTROL: un número que no está', app._osCoincide(oNueva, '1234') === false);
  })();

  // ── Consecutivo del número de orden ──
  console.log('\nNúmero de orden (consecutivo por año):');
  eq('lee el consecutivo', app._osSeqDe('OS-2026-0042', 'OS-2026-'), 42);
  eq('otro año no cuenta', app._osSeqDe('OS-2025-0099', 'OS-2026-'), 0);
  eq('la vieja larga no cuenta', app._osSeqDe('OS1785416697067', 'OS-2026-'), 0);
  eq('rellena a 4 dígitos', app._osPad4(7), '0007');
  eq('y no corta los de 4', app._osPad4(1234), '1234');

  // ── UNA FACTURA QUE CUBRE VARIAS ÓRDENES (02/08/2026) ──────────────────────
  // «Puedo deber 10 órdenes y si solo tengo para pagar 5, me facturan las 5 que YO
  //  escojo y las otras 5 quedan en deuda.»
  console.log('\nFactura sobre varias órdenes — reparto sin perder céntimos:');
  ok('_repartirBs definida', typeof app._repartirBs === 'function');
  eq('mitades exactas', app._repartirBs(100, [50, 50]), [50, 50]);
  eq('una sola parte se lleva todo', app._repartirBs(1234.56, [999]), [1234.56]);
  // 100 entre tres NO da tres decimales exactos: el último absorbe el céntimo.
  const tres = app._repartirBs(100, [1, 1, 1]);
  eq('tercios: el último absorbe el redondeo', tres, [33.33, 33.33, 33.34]);
  ok('tercios suman EXACTO el total', Math.abs(tres.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  // Caso real: base Bs 31.011,97 repartida entre 3 órdenes de pesos distintos.
  const real = app._repartirBs(31011.97, [12000, 9011.97, 10000]);
  ok('caso real suma EXACTO', Math.abs(real.reduce((a, b) => a + b, 0) - 31011.97) < 1e-9);
  eq('reparto proporcional (sin ceros ni negativos)', real.every(v => v > 0), true);
  ok('pesos en cero no rompen (reparte parejo)',
    Math.abs(app._repartirBs(90, [0, 0, 0]).reduce((a, b) => a + b, 0) - 90) < 1e-9);

  console.log('\nLo facturado y lo que sigue debiendo (facturación parcial):');
  // Escenario: orden de $100 (base pactada). Tasa 100 → Bs 10.000 = $100.
  const deuda = { id: 'CXP1', base_usd: 100, neto_pagar: 100, total_usd: 100, orden_id: 'OS-2026-0001' };
  app.CXP = [deuda];
  app.CXP_PAGOS = [];
  app.CXP_FACTURAS = [];
  app.CXP_FAC_LINEAS = [];
  eq('sin facturas: debe la base entera', app._cxpDeudaUsd(deuda), 100);
  eq('sin facturas: todo está por facturar', app._cxpFacturablePendiente(deuda), 100);

  // Llega una factura que cubre SOLO $60 de esa orden (base Bs 6.000, IVA 16%, ret IVA 75%).
  // neto = 6000 + 960 − 720 = 6240  → $62,40
  app.CXP_FACTURAS = [{ id: 'F1', cxp_id: 'CXP1', nro_factura: 'F-1', fecha: '2026-08-01',
    base_bs: 6000, iva_pct: 16, iva_bs: 960, ret_iva_bs: 720, ret_islr_bs: 0, neto_bs: 6240, tasa_val: 100 }];
  app.CXP_FAC_LINEAS = [{ id: 1, factura_id: 'F1', cxp_id: 'CXP1', orden_id: 'OS-2026-0001',
    base_bs: 6000, iva_bs: 960, ret_iva_bs: 720, ret_islr_bs: 0, neto_bs: 6240, tasa_val: 100 }];
  eq('facturado parcial: base $60', +app._cxpFacturadoUsd('CXP1').base.toFixed(2), 60);
  eq('queda por facturar $40', +app._cxpFacturablePendiente(deuda).toFixed(2), 40);
  app._aplicarFacturasACxp(deuda);
  // ⛔ Lo que rompía antes: la deuda quedaba reducida al pedazo facturado y los $40 del
  //    trabajo restante desaparecían sin que nadie los pagara.
  eq('la deuda = neto facturado ($62,40) + lo no facturado ($40)', deuda.neto_pagar, 102.40);
  eq('el COSTO = facturado con IVA ($69,60) + lo no facturado ($40)', deuda.total_usd, 109.60);
  eq('base_usd NO se pisa (es lo pactado en la orden)', deuda.base_usd, 100);

  // Ahora el proveedor factura el resto ($40 → Bs 4.000 + IVA).
  app.CXP_FACTURAS.push({ id: 'F2', cxp_id: 'CXP1', nro_factura: 'F-2', fecha: '2026-08-05',
    base_bs: 4000, iva_pct: 16, iva_bs: 640, ret_iva_bs: 480, ret_islr_bs: 0, neto_bs: 4160, tasa_val: 100 });
  app.CXP_FAC_LINEAS.push({ id: 2, factura_id: 'F2', cxp_id: 'CXP1', orden_id: 'OS-2026-0001',
    base_bs: 4000, iva_bs: 640, ret_iva_bs: 480, ret_islr_bs: 0, neto_bs: 4160, tasa_val: 100 });
  app._aplicarFacturasACxp(deuda);
  eq('ya no queda nada por facturar', +app._cxpFacturablePendiente(deuda).toFixed(2), 0);
  eq('deuda = solo el neto de las dos facturas', deuda.neto_pagar, 104);
  eq('dos facturas cuelgan de la misma orden', app._cxpFacturasDe('CXP1').length, 2);

  console.log('\nUna factura, varias órdenes:');
  // 3 órdenes de $50 c/u. Una sola factura cubre DOS y deja la tercera debiendo.
  const oA = { id: 'A', base_usd: 50, neto_pagar: 50, total_usd: 50, orden_id: 'OS-1' };
  const oB = { id: 'B', base_usd: 50, neto_pagar: 50, total_usd: 50, orden_id: 'OS-2' };
  const oC = { id: 'C', base_usd: 50, neto_pagar: 50, total_usd: 50, orden_id: 'OS-3' };
  app.CXP = [oA, oB, oC];
  app.CXP_PAGOS = [];
  app.CXP_FACTURAS = [{ id: 'FX', cxp_id: 'A', nro_factura: 'F-9', fecha: '2026-08-02',
    base_bs: 10000, iva_pct: 16, iva_bs: 1600, ret_iva_bs: 1200, ret_islr_bs: 0, neto_bs: 10400, tasa_val: 100 }];
  app.CXP_FAC_LINEAS = [
    { id: 10, factura_id: 'FX', cxp_id: 'A', orden_id: 'OS-1', base_bs: 5000, iva_bs: 800, ret_iva_bs: 600, ret_islr_bs: 0, neto_bs: 5200, tasa_val: 100 },
    { id: 11, factura_id: 'FX', cxp_id: 'B', orden_id: 'OS-2', base_bs: 5000, iva_bs: 800, ret_iva_bs: 600, ret_islr_bs: 0, neto_bs: 5200, tasa_val: 100 }
  ];
  app._aplicarFacturasACxp(oA); app._aplicarFacturasACxp(oB); app._aplicarFacturasACxp(oC);
  eq('orden 1 facturada → debe el neto', oA.neto_pagar, 52);
  eq('orden 2 facturada → debe el neto', oB.neto_pagar, 52);
  eq('orden 3 NO entró en la factura → sigue debiendo su base', oC.neto_pagar, 50);
  eq('la orden 3 no tiene ninguna factura', app._cxpFacturasDe('C').length, 0);
  eq('la factura aparece en las dos órdenes que cubre',
    [app._cxpFacturasDe('A').length, app._cxpFacturasDe('B').length], [1, 1]);
  eq('las líneas suman la base de la factura', 5000 + 5000, app.CXP_FACTURAS[0].base_bs);

  console.log('\nCompatibilidad: facturas viejas (sin líneas) se leen igual que antes:');
  app.CXP = [{ id: 'V1', base_usd: 80, neto_pagar: 80, total_usd: 80 }];
  app.CXP_FACTURAS = [{ id: 'FV', cxp_id: 'V1', nro_factura: 'F-VIEJA', fecha: '2026-07-01',
    base_bs: 8000, iva_pct: 16, iva_bs: 1280, ret_iva_bs: 960, ret_islr_bs: 0, neto_bs: 8320, tasa_val: 100 }];
  app.CXP_FAC_LINEAS = [];   // la migración todavía no corrió
  eq('la cabecera vale como línea única', app._cxpLineasParaDeuda('V1').length, 1);
  eq('facturado = la factura entera', +app._cxpFacturadoUsd('V1').base.toFixed(2), 80);
  eq('la deuda la encuentra igual', app._cxpFacturasDe('V1').length, 1);

  // ── Resumen ──
  console.log('\n──────────────');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
