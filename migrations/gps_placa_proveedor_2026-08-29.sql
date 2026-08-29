-- BETANGAR — GPS: la placa que usa el PROVEEDOR es un dato aparte de la placa del camión
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. El 29/08 el proveedor amplió el acceso de 1 a 10 unidades. Al pedir la
-- cuenta completa aparecieron las placas como las tiene ÉL, y una no casa con la
-- nuestra:
--
--   JAC-B008 — nuestra base: A04EO1P   ·   el proveedor: AO4E01P
--
-- Son la O y el 0 intercambiados. Medido: pidiendo `plateno=A04EO1P` el API contesta
-- conjunto vacío; con `AO4E01P` contesta con datos. Las otras 11 placas siguen el
-- patrón A+2 dígitos+2 letras+1 dígito+P, así que la que rompe el patrón es la del
-- proveedor — pero eso NO lo decide este archivo: hay que mirarla contra el carnet
-- del camión.
--
-- QUÉ CAMBIA. En vez de "sanear" la placa a la fuerza en el código (que es inventar
-- un dato y perder el original), se guarda la grafía del proveedor en su propia
-- columna. `placa` sigue siendo la placa DEL CAMIÓN; `placa_proveedor` es la cadena
-- con la que hay que hablarle al API. Si algún día corrigen la suya, se cambia acá
-- y no en el código.
--
-- ⛔ Sin esto, la única alternativa era casar normalizando O→0 dentro del conector:
-- funciona, pero deja el sistema afirmando en silencio que dos cadenas distintas son
-- la misma cosa, y el día que dos placas colisionen al normalizar el camión queda
-- cambiado sin que nadie se entere.
--
-- Reversa al final.

begin;

alter table public.gps_equipos
  add column if not exists placa_proveedor text;

comment on column public.gps_equipos.placa is
  'Placa REAL del camión, la del carnet. Es la que se muestra en pantalla.';
comment on column public.gps_equipos.placa_proveedor is
  'La cadena con la que el API de Foresight nombra a esta unidad, cuando difiere de '
  'la placa real (ej. JAC-B008: el proveedor la tiene como AO4E01P y la placa es '
  'A04EO1P). NULL = el proveedor usa la misma. El conector casa por esta si existe.';

-- Medido contra el API el 29/08/2026: la cuenta devuelve estas 10 unidades.
update public.gps_equipos
   set placa_proveedor = 'AO4E01P',
       notas = 'El proveedor la nombra AO4E01P (O y 0 cambiados respecto a la placa real). '
               'Con la placa real el API contesta vacío. Medido el 29/08/2026.'
 where cam = 'JAC-B008';

-- Las 10 que el proveedor SÍ da: se encienden. Cada día sin sondear es historial
-- que no va a existir nunca — el API no tiene endpoint de descarga.
update public.gps_equipos
   set activo = true,
       notas  = 'Acceso concedido por el proveedor el 29/08/2026 (antes: solo B010 en el demo).'
 where cam in ('JAC-B001','JAC-B002','JAC-B003','JAC-B004','JAC-B005',
               'JAC-B006','JAC-B007','JAC-B008','JAC-B009');

-- ⛔ B011 y B012 NO se encienden: medido una por una con control positivo, el API
-- contesta conjunto vacío para A15EN3P y A07EV6P mientras las otras 10 responden.
-- No están en la cuenta. Encenderlas solo llenaría `gps_sync_estado` de errores.
update public.gps_equipos
   set activo = false,
       notas  = 'NO está en la cuenta del proveedor: el API contesta conjunto vacío '
                '(medido el 29/08/2026, con las otras 10 respondiendo). Reclamado.'
 where cam in ('JAC-B011','JAC-B012');

commit;

-- ============================================================================
-- REVERSA:
--   update public.gps_equipos set activo = (cam='JAC-B010');
--   alter table public.gps_equipos drop column placa_proveedor;
-- ============================================================================
