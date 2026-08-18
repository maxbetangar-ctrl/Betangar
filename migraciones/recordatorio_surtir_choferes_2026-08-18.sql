-- ============================================================================
-- RECORDATORIO DE SURTIDA — a los 8 choferes que manejan y NO están anotando.
-- Pedido por Máximo el 18/08/2026. Va FIRMADO POR ÉL, en primera persona.
--
-- ⛔ LOS TELÉFONOS NO VAN ESCRITOS ACÁ: se buscan en `empleados`. Este repo es
--    PÚBLICO y ya hay un pendiente abierto por los números que quedaron dentro
--    del código; una lista de 8 celulares de trabajadores no se agrega a eso.
--    Además así el envío usa el número vigente y no una copia que envejece.
--
-- ⛔ A QUIÉNES: no a «los choferes» en abstracto. Se cruzó quién MANEJA
--    (`checklist`, desde el 22/07) contra quién ANOTA (`surtidas`). Manejan 12;
--    al día están 4 (JHAN ROA, MANUEL, MELVIN BARBOZA, REINALDO FARIA) y esos
--    NO reciben nada: un recordatorio que le llega a quien sí cumple enseña que
--    da igual cumplir.
--
-- ⚠️ LOS NOMBRES NO COINCIDEN ENTRE TABLAS. `surtidas`/`checklist` guardan la
--    forma corta (YURBENIS BERMUDEZ) y `empleados` la larga y hasta con otra
--    letra (YURVENIS FRANCISCO BERMUDEZ SUAREZ, con V). Cruzar por el nombre de
--    pila daba a Yurvenis en cero y lo habría acusado sin razón. Por eso la
--    lista va por nombre COMPLETO de `empleados`, verificada uno por uno.
--
-- ⚠️ Antes de escribir esto se comprobó que la app NO los esté trancando: la
--    foto es obligatoria (`chofer.html`, sin escape), pero desde el 08/08 cae a
--    la cámara del propio teléfono cuando el navegador niega el permiso. O sea
--    que se puede cumplir. Si no se hubiera podido, el recordatorio habría sido
--    culpar a alguien por una pared nuestra.
--
-- Idempotente: el WHERE NOT EXISTS sobre `ref` evita mandarlo dos veces.
-- ============================================================================

with destinatarios as (
  select
    e.nombre,
    -- El saludo usa solo el nombre de pila, capitalizado: "Buenas Ediober".
    -- `initcap` sobre el primer token; `empleados` los guarda en MAYÚSCULA.
    initcap(split_part(trim(regexp_replace(e.nombre, '\s+', ' ', 'g')), ' ', 1)) as pila,
    regexp_replace(coalesce(nullif(e.whatsapp,''), e.tel), '[^0-9]', '', 'g') as tel
  from empleados e
  where e.nombre in (
    'ANDRY  JOEL ORTEGA FARIA',            -- nunca anotó una surtida
    'EDIOBER GREGORIO BARRIOS GONZALEZ',   -- nunca anotó una surtida
    'OMAR DE JESUS NAVA MARILLO',          -- última 01/08
    'HELY JOSE URDANETA ESPINA',           -- última 05/08
    'JAVIER JOSE URDANETA FERNANDEZ',      -- última 05/08
    'JOSE ELITE ARANGUREN GONZALEZ',       -- última 05/08
    'RICHARD GREGORIO VILLALOBOS FARIA',   -- última 05/08
    'YURVENIS FRANCISCO BERMUDEZ SUAREZ'   -- última 05/08
  )
)
insert into cola_mensajes (tipo, telefono, mensaje, estado, ref)
select
  'comunicado',
  d.tel,
  'Buenas ' || d.pila || ', soy Máximo.' || chr(10) || chr(10) ||
  'Te pido algo que para mí es importante: cada vez que surtas, cárgalo en la app. ' ||
  'Es lo que me deja ver cuánto gasta de verdad tu unidad, y así no ando preguntando ' ||
  'después quién echó qué.' || chr(10) || chr(10) ||
  'Es un minuto:' || chr(10) ||
  '1) Abre la app y entra en ⛽ Surtir' || chr(10) ||
  '2) Marca de dónde surtiste: Galpón 1, Galpón 2 o Estación' || chr(10) ||
  '3) Escribe los litros' || chr(10) ||
  '4) 📷 Tomar foto al surtidor o al recibo' || chr(10) ||
  '5) 📍 Ubicar' || chr(10) ||
  '6) ✅ Registrar surtida' || chr(10) || chr(10) ||
  'Dos cosas por si acaso:' || chr(10) ||
  '• Sin señal se puede igual: queda guardado en el teléfono y sube solo cuando agarres señal.' || chr(10) ||
  '• Si la cámara no abre, sale un botón verde que dice «Tomar la foto con la cámara del teléfono». Con ese sigues.' || chr(10) || chr(10) ||
  'Si algo no te funciona, me escribes y lo vemos.' || chr(10) || chr(10) ||
  'Máximo',
  'pendiente',
  'recordatorio-surtir-20260818-' || d.nombre
from destinatarios d
where d.tel is not null and length(d.tel) >= 10
  -- ⛔ La guarda va por TELÉFONO, no por el `ref`. La primera corrida usó un `ref` armado con el
  --    número y esta versión lo arma con el nombre: si el candado mirara el `ref`, no encontraría
  --    lo ya enviado y les llegaría el mensaje POR SEGUNDA VEZ. Lo que decide si alguien ya lo
  --    recibió es a qué teléfono salió, no cómo se llamó la fila.
  and not exists (
    select 1 from cola_mensajes c
    where c.ref like 'recordatorio-surtir-20260818%'
      and right(regexp_replace(c.telefono, '[^0-9]', '', 'g'), 10) = right(d.tel, 10)
  );
