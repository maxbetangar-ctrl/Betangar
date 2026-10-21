// El worker NO le entrega mensajes a un canal caído.
//
// ⛔ POR QUÉ ESTA PRUEBA. Entregar a un canal caído DESARMA la caducidad de 12 h: el
//    caducador solo toca filas en 'pendiente', y el POST las pasa a 'enviado'. Wassenger
//    acepta con la sesión en `authorize`, se lo guarda, y lo suelta días después.
//    Medido el 21/10/2026 con los acuses del proveedor: el recordatorio de VIAJES del
//    10/10 17:04 le llegó a Gladis el 13/10 11:29 (66 h tarde) y dos salieron a la 01:53,
//    fuera de la franja 8:00–20:00. Lo reportó Alejandra: «están llegando muy tarde».
//
//   deno test pruebas/canal-caido-no-se-le-entrega.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canalCaido } from '../supabase/functions/procesar_cola_wassenger/index.ts';

// Las formas salen de medir `GET /devices/:id` el 21/10/2026, no de suponerlas.
const EN_PIE = { status: 'operative', session: { status: 'online', queue: { status: 'active', size: 0 } } };

Deno.test('canal en pie: no frena', () => {
  assertEquals(canalCaido(EN_PIE), null);
});

Deno.test('⛔ EL CASO REAL: la sesión en `authorize` frena la entrega', () => {
  const d = { ...EN_PIE, session: { ...EN_PIE.session, status: 'authorize' } };
  const m = canalCaido(d);
  assertEquals(typeof m, 'string');
  // El motivo tiene que NOMBRAR la causa, no decir «no se pudo enviar».
  // [[norma-un-mensaje-negativo-debe-decir-cual-causa]]
  assertEquals(m!.includes('authorize'), true);
});

Deno.test('`status: operative` NO alcanza: si la sesión no está online, frena igual', () => {
  assertEquals(canalCaido({ status: 'operative', session: { status: 'offline' } }) !== null, true);
});

Deno.test('aparato online pero la cola del proveedor trancada: frena y dice cuántos hay parados', () => {
  const d = { session: { status: 'online', queue: { status: 'paused', size: 27 } } };
  const m = canalCaido(d);
  assertEquals(m !== null, true);
  assertEquals(m!.includes('27'), true);
});

// ⛔ CONTROL POSITIVO. Si estas tres no pasan, la prueba de arriba no prueba nada:
//    estaría frenando por no encontrar la clave, no por el estado del canal. Un campo
//    que NO EXISTE se lee igual que uno en falso, y frenar toda la mensajería de la
//    casa por un cambio de la API sería peor que el problema que esto arregla.
//    [[norma-control-positivo-antes-de-creerle-al-vacio]]
Deno.test('CONTROL: sin `session` no se frena nada', () => {
  assertEquals(canalCaido({ status: 'operative' }), null);
});

Deno.test('CONTROL: respuesta vacía, null y undefined no explotan y no frenan', () => {
  assertEquals(canalCaido({}), null);
  assertEquals(canalCaido(null), null);
  assertEquals(canalCaido(undefined), null);
});

Deno.test('CONTROL: sesión online y `queue` ausente no frena', () => {
  assertEquals(canalCaido({ session: { status: 'online' } }), null);
});
