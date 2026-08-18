-- ============================================================================
-- A ALEJANDRA (QA): qué cambió hoy y qué necesito que pruebe  ·  18/08/2026
--
-- Pedido de Máximo. Firmado por él, en primera persona.
--
-- ⛔ EL TELÉFONO NO VA ESCRITO ACÁ: se busca en `empleados`. Este repo es PÚBLICO.
--    Y de paso usa el número vigente y no una copia que envejece.
--    ⚠️ Se toma `whatsapp` y no `tel`: Alejandra es uno de los dos casos donde no
--    coinciden (0412 de Venezuela vs +52 de México). Lo decidió el historial, no
--    una suposición: 50 mensajes entregados al mexicano, CERO al venezolano.
--
-- Por qué el mensaje está ordenado así y no como un listado de cambios:
--   1º lo que tiene que PROBAR, porque puede trancar a la oficina y es urgente.
--   2º lo que va a VER DISTINTO y NO es un error — si no se le dice, lo reporta
--      como bug y pierde medio día persiguiendo un descuadre que pusimos nosotros.
--   3º lo secundario.
-- Un aviso que mezcla las tres cosas se lee como ruido y no se actúa sobre nada.
--
-- Idempotente por `ref`.
-- ============================================================================

insert into cola_mensajes (tipo, telefono, mensaje, estado, ref)
select 'comunicado',
       regexp_replace(coalesce(nullif(e.whatsapp,''), e.tel), '[^0-9]', '', 'g'),
  'Buenas Alejandra, soy Máximo.' || chr(10) || chr(10) ||
  'Te pongo al día con lo que cambió hoy y te pido que, apenas puedas, me hagas una prueba.' || chr(10) || chr(10) ||

  '🔴 LO QUE NECESITO QUE PRUEBES' || chr(10) || chr(10) ||
  'Al cargar una factura para pagar (Proveedores → Retenciones) ahora es OBLIGATORIO subir el soporte: ' ||
  'la factura, la nota de crédito o el recibo que tengas. Sin eso no deja cerrar.' || chr(10) || chr(10) ||
  'Si de verdad no lleva soporte —el caso típico es la nómina— hay un botón que dice ' ||
  '«Este pago no lleva soporte…» que te pide escribir por qué. Con eso avanza, y el motivo queda guardado.' || chr(10) || chr(10) ||
  'Comprobame estas cuatro:' || chr(10) ||
  '1) Con el soporte subido, que la factura se guarde normal y el pago se registre como siempre.' || chr(10) ||
  '2) Sin soporte y sin motivo, que NO deje guardar.' || chr(10) ||
  '3) Con el botón de «no lleva soporte» y el motivo escrito, que sí deje.' || chr(10) ||
  '4) Que después, en la cuenta por pagar, salga el clip 📎 y al tocarlo abra el documento.' || chr(10) || chr(10) ||
  'Si algo de esto traba el trabajo, avisame de una vez y lo suelto. Prefiero eso a que se acumulen pagos.' || chr(10) || chr(10) ||

  '⚠️ COSAS QUE VAS A VER DISTINTAS Y NO SON ERRORES' || chr(10) || chr(10) ||
  '• Los números de combustible de julio cambiaron. Se pasaron 40 cargas de estación (6.862 L, US$ 3.792,65) ' ||
  'que estaban en el módulo viejo de despacho y el chofer nunca registró. Salen marcadas como cargadas por la ' ||
  'oficina, sin foto y algunas sin chofer: es a propósito, no están mal cargadas.' || chr(10) || chr(10) ||
  '• Va a empezar a llegar un aviso nuevo: «La carga no cabe en el tanque». Compara los litros cargados contra ' ||
  'el espacio libre del tanque. No acusa a nadie: dice los dos números y que hay que preguntar cuál está mal, ' ||
  'porque puede ser la medición y no la carga.' || chr(10) || chr(10) ||
  '• Le escribí a 8 choferes recordándoles que carguen la surtida en la app.' || chr(10) || chr(10) ||

  '📋 SI TE QUEDA TIEMPO' || chr(10) || chr(10) ||
  '• Samuel tiene una pantalla nueva en Operativo para registrar cuando sale gasoil del tanque para algo que ' ||
  'no es un camión (la planta eléctrica, por ejemplo). Es de tres toques. Si podés, miralo con él.' || chr(10) || chr(10) ||
  '• La auditoría de combustible ahora también está en Flotilla, VIDECA y la demo, no solo acá.' || chr(10) || chr(10) ||

  'Cualquier cosa me escribís.' || chr(10) || chr(10) ||
  'Máximo',
  'pendiente',
  'aviso-alejandra-cambios-20260818'
from empleados e
where e.nombre = 'VIRGINIA ALEJANDRA CASTILLO MEDINA'
  and not exists (select 1 from cola_mensajes c where c.ref = 'aviso-alejandra-cambios-20260818');
