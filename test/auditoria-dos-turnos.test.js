// ══════════════════════════════════════════════════════════════════════════════
// LA AUDITORÍA DE COMBUSTIBLE CON DOS TURNOS
//
// 🔴 Máximo, 06/11/2026: «el sistema indica que inicio con 34cm y termino con
//    34 cm osea no gasto combustible hoy». Y: «ese modulo es la auditoria de
//    combustible y le tengo puesto el ojo. Diario reviso la auditoria».
//
// Arreglar la llave de la tabla NO alcanzaba: la pantalla juntaba por
// `unidad|fecha|momento` igual que la tabla, así que con dos turnos metía la
// salida del diurno y la del nocturno en la misma bolsa y se quedaba con la
// última. Media corrección deja el defecto vivo del lado que se mira.
// [[norma-correccion-heredada-toca-todas-las-tablas]]
//
// ⛔ Y EL PRIMER ARREGLO TAMPOCO ALCANZÓ. Se emparejaba recorriendo las
//    mediciones por hora: una salida ABRÍA la jornada y la siguiente llegada la
//    CERRABA. Al reponer la salida de 37 cm que el nocturno había pisado, quedó
//    grabada DESPUÉS de su propia llegada y la jornada del diurno se partió en
//    dos: una llegada huérfana y una salida sin cerrar. El consumo volvió a no
//    calcularse. Lo encontró `scripts/ver-auditoria-dos-turnos.mjs`.
//    ⇒ Ahora se arma POR GRUPO (unidad+fecha+turno), que es exactamente la
//      llave única de la tabla. Lo que una regla de la base ya garantiza no se
//      vuelve a deducir del orden en que llegaron las filas.
//
//   node test/auditoria-dos-turnos.test.js
// ══════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
const ok = (n, c) => eq(n, !!c, true);

console.log('\nAUDITORÍA DE COMBUSTIBLE — DOS TURNOS\n');

// ── 1. El código, tal como quedó ───────────────────────────────────────────
ok('el dedupe junta POR TURNO',
   APP.includes("var k=[m.vehiculo_id,String(m.fecha).slice(0,10),m.momento,_acTurno(m)].join('|');"));
ok('las jornadas se arman por grupo unidad+fecha+turno',
   APP.includes("var f=String(m.fecha).slice(0,10), t=_acTurno(m), k=f+'|'+t;"));
ok('la jornada guarda su turno',
   APP.includes('turno:g.turno,'));
ok('«corregida» y «no confiable» leen la llave CON turno',
   APP.includes('var _llave=function(m){ return [m.vehiculo_id,String(m.fecha).slice(0,10),m.momento,_acTurno(m)]'));
ok('una medición sin turno cuenta como diurno (datos viejos)',
   APP.includes("return String(m&&m.turno||'diurno');"));
ok('ya NO se empareja recorriendo en orden',
   !APP.includes("if(abierta)jor.push(abierta);                     // salida sin llegada"));

// ── 2. La regla, reproducida ───────────────────────────────────────────────
// ⛔ Reimplementa la regla ACTUAL —por grupo— para poder correrla sin
//    navegador. Si la del `app.js` cambia, los chequeos de arriba se ponen
//    rojos y esta copia deja de valer: por eso van juntas.
function jornadas(ms) {
  const T = (m) => String(m.turno || 'diurno');
  const g = {}, orden = [];
  for (const m of ms) {
    const k = String(m.fecha).slice(0, 10) + '|' + T(m);
    if (!g[k]) { g[k] = { fecha: String(m.fecha).slice(0, 10), turno: T(m), salida: null, llegada: null }; orden.push(k); }
    if (m.momento === 'salida' || m.momento === 'llegada') {
      const ant = g[k][m.momento];
      if (!ant || String(m.created_at || '') >= String(ant.created_at || '')) g[k][m.momento] = m;
    }
  }
  orden.sort();
  return orden.map((k) => ({
    turno: g[k].turno,
    salida: g[k].salida ? g[k].salida.altura_cm : null,
    llegada: g[k].llegada ? g[k].llegada.altura_cm : null,
    por: (g[k].salida && g[k].salida.registrado_por) || (g[k].llegada && g[k].llegada.registrado_por) || '',
  }));
}

// EL CASO REAL del 06/11 en el B009. ⛔ Las horas vienen CRUZADAS a propósito:
// la salida del nocturno quedó grabada a las 06:20, la llegada del diurno a las
// 16:10, y la salida del diurno se repuso DESPUÉS de las dos. Ningún orden
// cronológico las empareja bien — por eso se agrupa, no se recorre.
const B009 = [
  { fecha: '2026-11-06', momento: 'salida',  turno: 'nocturno', altura_cm: 34, registrado_por: 'JOSE ALFREDO', created_at: '2026-11-06T10:20:47Z' },
  { fecha: '2026-11-06', momento: 'llegada', turno: 'diurno',   altura_cm: 34, registrado_por: 'JORWIN',       created_at: '2026-11-06T20:10:30Z' },
  { fecha: '2026-11-06', momento: 'salida',  turno: 'diurno',   altura_cm: 37, registrado_por: 'JORWIN',       created_at: '2026-11-07T01:00:00Z' },
];
const j = jornadas(B009);
eq('salen DOS jornadas, no una ni tres', j.length, 2);
const dia = j.find((x) => x.turno === 'diurno');
const noc = j.find((x) => x.turno === 'nocturno');
eq('el diurno: salió con 37 y llegó con 34', [dia.salida, dia.llegada], [37, 34]);
ok('…o sea que SÍ gastó combustible', dia.salida > dia.llegada);
eq('el nocturno: salió con 34 y todavía no llega', [noc.salida, noc.llegada], [34, null]);
eq('cada jornada con su chofer', [dia.por, noc.por], ['JORWIN', 'JOSE ALFREDO']);

// ⛔ ASÍ SE VEÍA CUANDO MÁXIMO LO REPORTÓ: no existía la columna, así que en la
//    base sólo quedaban las dos filas que sobrevivieron al pisotón.
const comoAntes = jornadas(
  B009.filter((m) => !(m.turno === 'diurno' && m.momento === 'salida'))
      .map(({ turno, ...resto }) => resto));
eq('ANTES: una sola jornada', comoAntes.length, 1);
eq('ANTES: 34 → 34, cero consumo', [comoAntes[0].salida, comoAntes[0].llegada], [34, 34]);

// ── 3. Lo que NO tiene que romperse ────────────────────────────────────────
const unTurno = jornadas([
  { fecha: '2026-11-05', momento: 'salida',  turno: 'diurno', altura_cm: 40, created_at: '1' },
  { fecha: '2026-11-05', momento: 'llegada', turno: 'diurno', altura_cm: 31, created_at: '2' },
]);
eq('un solo turno: una jornada, 40 → 31', [unTurno.length, unTurno[0].salida, unTurno[0].llegada], [1, 40, 31]);

const vieja = jornadas([
  { fecha: '2026-06-20', momento: 'salida',  altura_cm: 44, created_at: '1' },
  { fecha: '2026-06-20', momento: 'llegada', altura_cm: 38, created_at: '2' },
]);
eq('sin turno (datos viejos): sigue siendo una jornada diurna', [vieja.length, vieja[0].turno], [1, 'diurno']);

// Una jornada incompleta sigue saliendo incompleta, no se inventa la otra mitad.
// Es el caso REAL del B004: su salida del diurno la pisó el nocturno y no se
// puede recuperar — eso tiene que VERSE, no taparse.
const b004 = jornadas([
  { fecha: '2026-11-06', momento: 'llegada', turno: 'diurno',   altura_cm: 34.5, registrado_por: 'MELVIN',   created_at: '1' },
  { fecha: '2026-11-06', momento: 'salida',  turno: 'nocturno', altura_cm: 34.5, registrado_por: 'YOHENDRY', created_at: '2' },
]);
eq('B004: dos jornadas, las dos incompletas y a la vista', b004.length, 2);
eq('…la del diurno sin salida', [b004[0].turno, b004[0].salida, b004[0].llegada], ['diurno', null, 34.5]);
eq('…la del nocturno sin llegada', [b004[1].turno, b004[1].salida, b004[1].llegada], ['nocturno', 34.5, null]);

// Dos días seguidos no se mezclan.
const dosDias = jornadas([
  { fecha: '2026-11-05', momento: 'salida',  turno: 'diurno', altura_cm: 40, created_at: '1' },
  { fecha: '2026-11-06', momento: 'llegada', turno: 'diurno', altura_cm: 31, created_at: '2' },
]);
eq('dos días distintos no se emparejan entre sí', dosDias.length, 2);


// ── 4. LO QUE ENTRA AL CAMIÓN NO SE CUENTA DOS VECES ───────────────────────
// El consumo es `salida − llegada + lo que le echaron en el camino`. La
// auditoría le sumaba a CADA jornada del día TODAS las surtidas de ese día:
// con un turno era exacto; con dos, los mismos litros se cuentan dos veces y
// los dos choferes aparecen consumiendo 350 L de más.
ok('las surtidas de la jornada se piden POR TURNO',
   APP.includes('j.desp=_acEntradas(j.cam,j.fecha,j.fecha,true,j.turno);'));
ok('`_acEntradas` sabe filtrar por turno',
   APP.includes("if(turno && String(s.turno||'')!==String(turno))return;"));
// ⛔ La firma se comprueba con REGEX y no con texto exacto. Lo que esta línea tiene que
//    garantizar es que `turno` siga siendo el 5º parámetro —si se corriera de lugar, una llamada
//    vieja le pasaría otra cosa y el filtro de arriba se aplicaría con basura—. Pedir la firma
//    LITERAL hacía que cualquier parámetro agregado al final pusiera roja una prueba que no
//    tenía nada que ver: pasó el 07/11 al sumar `despuesDe`. Una prueba que se rompe por un
//    cambio que no afecta lo que mide enseña a ignorarla.
ok('una consulta por PERÍODO (sin turno) las sigue contando todas',
   /function _acEntradas\(cam,desde,hasta,incluirDesde,turno(,[A-Za-z0-9_]+)*\)\{/.test(APP));
ok('el gasoil histórico no se le carga al nocturno, que no existía',
   APP.includes("if(turno && turno!=='diurno')return;"));

// ── 5. LOS KM DE LA JORNADA SON LOS DE SU TURNO ────────────────────────────
// De acá sale el km/L. Con dos checklists en el día, un `.find()` sin turno
// toma siempre el primero y el rendimiento de los dos turnos sale mal.
ok('el checklist se busca por turno',
   APP.includes("String(c.turno||'diurno')===String(j.turno)"));
ok('la auditoría TRAE el turno del checklist',
   APP.includes("select('fecha,cam,turno,conductor,km_salida,km_entrada')"));

// ── 6. A QUIÉN SE LE RECLAMA ───────────────────────────────────────────────
// No es exactitud de números: es no acusar al chofer equivocado.
ok('`_quien` recibe el turno', APP.includes('var _quien=function(cam,fecha,turno){'));
// ⛔ No se cuenta un numero exacto: al agregar R10c pasaron a ser diez y la
//    prueba se puso roja sin que nada estuviera mal. Lo que hay que garantizar
//    no es «cuantos hay» sino que NINGUNO quede sin turno -- eso lo mide el
//    chequeo de abajo. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
ok('todos los avisos le pasan el turno (son >= 9)',
   APP.split('_quien(j.cam,j.fecha,j.turno)').length - 1 >= 9);
ok('no queda ninguna llamada sin turno',
   APP.indexOf('_quien(j.cam,j.fecha)') === -1);

console.log('\n  ' + pass + ' pasaron, ' + fail + ' fallaron\n');
process.exit(fail ? 1 : 0);
