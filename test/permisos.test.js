// Cuando el teléfono niega cámara o ubicación, hay que mandar a la persona al lugar CORRECTO.
//
// Caso real (2026-08-08): a Omar le salía «Cámara bloqueada en este teléfono» y el mensaje lo
// mandaba al candado de la dirección. Fue, no encontró ninguna opción de Cámara ahí, y concluyó que
// la app estaba rota. No lo estaba: el permiso estaba cortado un nivel más arriba, en el permiso
// que Android le da a Chrome — y ahí el candado NO muestra nada.
//
// Por el mismo error del navegador llegan DOS bloqueos que se arreglan en LUGARES DISTINTOS:
//   (a) el SITIO está bloqueado           → candado al lado de la dirección
//   (b) el navegador no tiene el permiso  → Ajustes del teléfono
// Lo que esta prueba fija: que SIEMPRE se nombren los dos, que el orden dependa del estado real del
// permiso, y que el camino nombre el navegador y el sistema de QUIEN está mirando.
const P = require('../permisos.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const c = JSON.stringify(got) === JSON.stringify(exp);
  if (c) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → got ' + JSON.stringify(got) + ', exp ' + JSON.stringify(exp)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// Node 21+ trae su propio `navigator` de solo lectura: hay que redefinirlo, no asignarlo.
function comoSiFuera(ua) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua, maxTouchPoints: 5 }, configurable: true, writable: true
  });
}
const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-A146M) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  iphoneSafari:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/126 Mobile/15E148 Safari/604.1',
  samsung:       'Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36'
};
const txt = (t, e) => P.pasos(t, e).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const orden = (t, e) => {
  const s = txt(t, e);
  const i1 = s.indexOf('candado'), i2 = s.indexOf('Ajustes');
  return (i1 < 0 || i2 < 0) ? 'FALTA UNO' : (i1 < i2 ? 'candado primero' : 'Ajustes primero');
};

// ── 1. Los DOS caminos, siempre ─────────────────────────────────────────────────────────────
console.log('\nSiempre se nombran los DOS lugares (nunca uno solo):');
comoSiFuera(UA.androidChrome);
['camera', 'geolocation'].forEach(function (t) {
  ['denied', 'prompt', 'granted', ''].forEach(function (e) {
    ok(t + ' / estado "' + (e || 'desconocido') + '" nombra candado y Ajustes',
      /candado/.test(txt(t, e)) && /Ajustes/.test(txt(t, e)));
  });
});

// ── 2. El orden depende de dónde está el bloqueo ────────────────────────────────────────────
console.log('\nEl orden lo decide el estado REAL del permiso:');
eq('sitio bloqueado (denied) → primero el candado', orden('camera', 'denied'), 'candado primero');
eq('sitio NO bloqueado (prompt) → primero Ajustes', orden('camera', 'prompt'), 'Ajustes primero');
eq('sitio concedido y aun así falló → primero Ajustes', orden('camera', 'granted'), 'Ajustes primero');
// Si no se sabe, va primero Ajustes: es el camino que NO tiene callejón sin salida. Mandar a
// alguien al candado cuando ahí no hay nada que tocar es lo que rompió la confianza de Omar.
eq('no se sabe → primero Ajustes (el camino sin callejón sin salida)', orden('camera', ''), 'Ajustes primero');

// ── 3. El camino es el del teléfono de quien mira ───────────────────────────────────────────
console.log('\nEl camino nombra el navegador y el sistema de quien está mirando:');
comoSiFuera(UA.androidChrome);
ok('Android Chrome → Ajustes → Aplicaciones → Chrome', /Aplicaciones .* Chrome/.test(txt('camera', '')));
comoSiFuera(UA.iphoneSafari);
ok('iPhone Safari → Ajustes → Safari (no "Aplicaciones")', /Ajustes .* Safari/.test(txt('camera', '')) && !/Aplicaciones/.test(txt('camera', '')));
ok('iPhone + ubicación → Privacidad → Localización', /Privacidad .* Localizaci/.test(txt('geolocation', '')));
comoSiFuera(UA.iphoneChrome);
ok('iPhone Chrome se detecta como iPhone, no como Android', P.esIOS() === true && P.nombreNavegador() === 'Chrome');
comoSiFuera(UA.samsung);
ok('Samsung Internet se nombra como lo ve el usuario', /Internet \(Samsung\)/.test(txt('camera', '')));

// ── 4. La ubicación además recuerda el GPS del teléfono ─────────────────────────────────────
console.log('\nLa ubicación recuerda algo que la cámara no necesita:');
comoSiFuera(UA.androidChrome);
ok('ubicación menciona encender el GPS', /GPS del tel/.test(txt('geolocation', '')));
ok('cámara NO habla de GPS', !/GPS/.test(txt('camera', '')));

// ── 5. Nunca se queda sin respuesta ─────────────────────────────────────────────────────────
// Si `navigator.permissions` no existe o no contesta, igual hay que decirle algo a la persona.
console.log('\nNunca deja a la persona sin instrucciones:');
comoSiFuera(UA.androidChrome);   // sin `permissions` en el stub
let respondio = null;
P.explicar('camera', function (html) { respondio = html; });
ok('sin navigator.permissions responde igual, y al instante', respondio !== null && /candado/.test(String(respondio)));

// Y si `permissions.query` se cuelga, el timeout responde de todos modos.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: UA.androidChrome, maxTouchPoints: 5, permissions: { query: function () { return new Promise(function () { }); } } },
  configurable: true, writable: true
});
let tarde = null;
P.explicar('geolocation', function (html) { tarde = html; });
eq('si la consulta se cuelga, todavía no respondió (espera al timeout)', tarde, null);
setTimeout(function () {
  ok('pero responde igual pasado el plazo', tarde !== null && /Ajustes/.test(String(tarde)));
  console.log('\n──────────────');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  if (fail) process.exit(1);
}, 1500);
