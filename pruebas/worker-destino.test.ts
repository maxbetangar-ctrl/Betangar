// Control de la decisión que CANCELA un mensaje en `procesar_cola_wassenger`.
// Las formas de abajo NO son inventadas: salen de medir la API el 15/10/2026.
//   deno test pruebas/worker-destino.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { destinoDelMensaje, cambioElDestino } from '../supabase/functions/procesar_cola_wassenger/index.ts';

const REAL = '5219512180813@c.us';        // el chat de verdad de Alejandra
const FANTASMA = '529512180813@c.us';     // el mismo numero sin el «1»: no existe
const PEDIDO = '5219512180813';

Deno.test('POST /messages: el destino viene en `wid`', () => {
  assertEquals(destinoDelMensaje({ id: 'abc', wid: REAL }), REAL);
});

Deno.test('mensaje guardado: `chat` es un STRING, no un objeto', () => {
  assertEquals(destinoDelMensaje({ id: 'abc', chat: REAL, to: REAL }), REAL);
});

Deno.test('`chat` como objeto tambien se lee', () => {
  assertEquals(destinoDelMensaje({ chat: { id: REAL } }), REAL);
});

Deno.test('cae a `to` si no hay nada mejor', () => {
  assertEquals(destinoDelMensaje({ id: 'abc', to: REAL }), REAL);
});

Deno.test('una respuesta en arreglo', () => {
  assertEquals(destinoDelMensaje([{ wid: REAL }]), REAL);
});

Deno.test('sin ningun campo de destino: null, y NO se bloquea', () => {
  assertEquals(destinoDelMensaje({ id: 'abc' }), null);
  assertEquals(cambioElDestino(null, PEDIDO), false);
});

Deno.test('⛔ EL CASO REAL: le comio el «1» → cambio el destino', () => {
  assertEquals(cambioElDestino(FANTASMA, PEDIDO), true);
});

Deno.test('mismo destino: no se toca (y asi el PRIMER mensaje a alguien nuevo sale)', () => {
  assertEquals(cambioElDestino(REAL, PEDIDO), false);
  assertEquals(cambioElDestino('584127636857@c.us', '584127636857'), false);
});

Deno.test('un grupo no se juzga por digitos', () => {
  assertEquals(cambioElDestino('123456789-123@g.us', PEDIDO), false);
});

Deno.test('control positivo: con los digitos vacios no decide nada', () => {
  assertEquals(cambioElDestino('@c.us', PEDIDO), false);
  assertEquals(cambioElDestino(REAL, ''), false);
});
