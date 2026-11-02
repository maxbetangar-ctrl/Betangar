// ═══════════════════════════════════════════════════════════════════════════════
// LA VENTANA DE HORA — probada con los dos mensajes que NO debieron salir
//
//   deno test ventana-hora.test.ts
//
// 🔴 POR QUÉ EXISTE (02/11/2026). La norma de la casa es no escribirle a nadie
//    fuera de 8:00-20:00 de Venezuela, y la cumplían SEIS funciones emisoras,
//    cada una por su cuenta. El worker de la cola —por el que pasan TODOS los
//    mensajes— no la miraba. Medido en `cola_mensajes`:
//      · 28/10 23:52 → un `soporte-programado` a Alejandra, que vive acá
//      · 28/10 22:00 → un `cierre-checklist` a un chofer
//    Y era justo lo que Virginia había reportado el 21/10: «los recordatorios
//    están llegando muy tarde».
//
// ⛔ LOS DOS CASOS REALES SON LAS DOS PRIMERAS PRUEBAS, con su hora exacta en
//    UTC. Una prueba que solo mira «las 3 de la mañana» pasa en verde sin cubrir
//    el caso que de verdad pasó. [[norma-la-foto-que-manda-la-persona-es-el-diagnostico]]
// ═══════════════════════════════════════════════════════════════════════════════
import { assertEquals } from "jsr:@std/assert@1";
import { corteDeCaducidad, horaVE, enHorarioVE, leerVentana } from "./ventana-hora.ts";

const V = { desde: 8, hasta: 20 };
const en = (iso: string) => enHorarioVE(new Date(iso), V);

// ── Los dos que de verdad salieron y no debían ──────────────────────────────
Deno.test("el mensaje de las 23:52 a Alejandra NO habria salido", () => {
  // 28/10 23:52 VE = 29/10 03:52 UTC
  assertEquals(horaVE(new Date("2026-10-29T03:52:00Z")), 23);
  assertEquals(en("2026-10-29T03:52:00Z"), false);
});

Deno.test("el recordatorio de las 22:00 al chofer NO habria salido", () => {
  // 28/10 22:00 VE = 29/10 02:00 UTC
  assertEquals(horaVE(new Date("2026-10-29T02:00:00Z")), 22);
  assertEquals(en("2026-10-29T02:00:00Z"), false);
});

// ── Los bordes, que es donde se rompe una ventana ───────────────────────────
Deno.test("las 8:00 en punto SI entran, y las 7:59 no", () => {
  assertEquals(en("2026-11-02T12:00:00Z"), true);   // 08:00 VE
  assertEquals(en("2026-11-02T11:59:00Z"), false);  // 07:59 VE
});

Deno.test("las 19:59 SI entran, y las 20:00 en punto ya no", () => {
  assertEquals(en("2026-11-02T23:59:00Z"), true);   // 19:59 VE
  assertEquals(en("2026-11-03T00:00:00Z"), false);  // 20:00 VE
});

Deno.test("la medianoche da 00 en este runtime, no 24", () => {
  // Si algún día da 24, la ventana sigue bien (24 también queda afuera), pero
  // el número no se puede usar para nada más sin volver a medirlo.
  assertEquals(horaVE(new Date("2026-11-02T04:00:00Z")), 0);
  assertEquals(en("2026-11-02T04:00:00Z"), false);
});

// ── La ventana es configurable, y una ventana rara no la rompe ──────────────
Deno.test("una ventana distinta se respeta", () => {
  // Con 6-22, el recordatorio de las 22:00 sigue afuera (el tope es exclusivo)
  // y el de las 23:52 también.
  assertEquals(enHorarioVE(new Date("2026-10-29T02:00:00Z"), { desde: 6, hasta: 22 }), false);
  // pero las 7:00 ya entrarían
  assertEquals(enHorarioVE(new Date("2026-11-02T11:00:00Z"), { desde: 6, hasta: 22 }), true);
});

// ⛔ CONTROL POSITIVO DE LA PRUEBA: que estas aserciones sepan ver una ventana
//    que deja pasar todo. Sin esto, una `enHorarioVE` que devolviera siempre
//    `false` pasaría los dos casos reales en verde — y sería un worker que no
//    manda nunca nada. [[norma-control-positivo-antes-de-creerle-al-vacio]]
Deno.test("una ventana de 0 a 24 deja pasar incluso la medianoche", () => {
  assertEquals(enHorarioVE(new Date("2026-11-02T04:00:00Z"), { desde: 0, hasta: 24 }), true);
  assertEquals(enHorarioVE(new Date("2026-10-29T03:52:00Z"), { desde: 0, hasta: 24 }), true);
});

// ── El lector de la configuración: el modo seguro es NO abrir la ventana ────
Deno.test("sin configuracion: 8-20 y los dos numeros de la casa", () => {
  const r = leerVentana(null, () => {});
  assertEquals(r.ventana, { desde: 8, hasta: 20 });
  assertEquals(r.sinLimite, ["584147379886", "573017509763"]);
});

Deno.test("una configuracion valida se usa", () => {
  const r = leerVentana('{"desde":7,"hasta":21,"sin_limite":["584147379886"]}', () => {});
  assertEquals(r.ventana, { desde: 7, hasta: 21 });
  assertEquals(r.sinLimite, ["584147379886"]);
});

Deno.test("una ventana al reves se IGNORA y avisa", () => {
  const dichos: string[] = [];
  const r = leerVentana('{"desde":20,"hasta":8}', (s) => dichos.push(s));
  assertEquals(r.ventana, { desde: 8, hasta: 20 });
  assertEquals(dichos.length > 0, true);
});

Deno.test("sin_limite vacia NO deja a la casa sin avisarse de noche", () => {
  const dichos: string[] = [];
  const r = leerVentana('{"sin_limite":[]}', (s) => dichos.push(s));
  assertEquals(r.sinLimite, ["584147379886", "573017509763"]);
  assertEquals(dichos.length > 0, true);
});

Deno.test("un JSON roto no abre la ventana", () => {
  const dichos: string[] = [];
  const r = leerVentana("{esto no es json", (s) => dichos.push(s));
  assertEquals(r.ventana, { desde: 8, hasta: 20 });
  assertEquals(dichos.length > 0, true);
});

Deno.test("los numeros se limpian de signos", () => {
  const r = leerVentana('{"sin_limite":["+58 414-737.9886"]}', () => {});
  assertEquals(r.sinLimite, ["584147379886"]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// EL CORTE DE CADUCIDAD — que la retención propia no cuente como abandono
// ⚠️ Venezuela es UTC-4 y no mueve el reloj, así que 08:05 VE = 12:05Z.
// ═══════════════════════════════════════════════════════════════════════════════

const VE = (iso: string) => new Date(iso); // los literales ya van en Z, explícitos

Deno.test('el caso que iba a perder mensajes: encolado 20:01, se barre a las 8:05 → NO caduca', () => {
  const ahora = VE('2026-11-03T12:05:00Z');            // 08:05 VE
  const corte = corteDeCaducidad(ahora, { desde: 8, hasta: 20 }, 12);
  const encolado = VE('2026-11-03T00:01:00Z');          // 20:01 VE del 02
  assertEquals(encolado > corte, true,
    `encolado ${encolado.toISOString()} deberia sobrevivir al corte ${corte.toISOString()}`);
  // Con el corte VIEJO (12 h de reloj) habria muerto: esa es la prueba del bug.
  const corteViejo = new Date(ahora.getTime() - 12 * 3600_000);
  assertEquals(encolado < corteViejo, true, 'el corte de reloj si lo mataba');
});

Deno.test('el que SI tuvo 12 h de horario y nadie lo mando: caduca', () => {
  const ahora = VE('2026-11-03T12:05:00Z');            // 08:05 VE
  const corte = corteDeCaducidad(ahora, { desde: 8, hasta: 20 }, 12);
  // 12 h entregables hacia atras desde 08:05 VE caen en 08:05 VE del dia anterior.
  const viejo = VE('2026-11-02T11:00:00Z');             // 07:00 VE del 02
  assertEquals(viejo < corte, true, 'tuvo toda la jornada del 02 y no salio');
});

Deno.test('ventana angosta (8-18): lo encolado a las 18:05 llega vivo a la manana', () => {
  const ahora = VE('2026-11-03T12:05:00Z');            // 08:05 VE
  const corte = corteDeCaducidad(ahora, { desde: 8, hasta: 18 }, 12);
  const encolado = VE('2026-11-02T22:05:00Z');          // 18:05 VE del 02
  assertEquals(encolado > corte, true, 'con 8-18 la noche es mas larga y no debe castigar');
});

Deno.test('sin ventana (0-24) el corte es exactamente el de reloj', () => {
  const ahora = VE('2026-11-03T12:05:00Z');
  const corte = corteDeCaducidad(ahora, { desde: 0, hasta: 24 }, 12);
  assertEquals(corte.getTime(), ahora.getTime() - 12 * 3600_000);
});

Deno.test('una ventana imposible no cuelga el worker', () => {
  const corte = corteDeCaducidad(VE('2026-11-03T12:05:00Z'), { desde: 5, hasta: 5 }, 12);
  // Se frena en el tope de 30 dias en vez de girar para siempre.
  assertEquals(corte < VE('2026-10-05T00:00:00Z'), true);
});
