-- ════════════════════════════════════════════════════════════════════════════
-- MOTOR DE CUBICACIÓN POR UNIDAD   2026-07-25
--
-- Máximo: «esa medida de 600 es de los JAC y en Flotilla hay muchas marcas».
-- Una tabla de cubicación describe UN TANQUE. Aplicarle a un carro la tabla de otro es
-- inventar litros. Y una tabla que sale de dividir la capacidad entre la altura tampoco
-- es una medición: es una división — eso hacía que el sistema cantara TANQUE LLENO a
-- 46 cm cuando faltaban 65 L por meter.
--
-- QUÉ SE GUARDA: las MEDIDAS, no solo la tabla. La tabla se calcula de ellas; si solo se
-- guarda el resultado, el día que alguien dude no hay cómo rehacerla ni saber de dónde salió.
--
-- LAS TRES FORMAS que cubren la flota:
--   redondeado : el de aluminio típico de camión (ancho, alto, largo + radio de esquina)
--   cilindro   : el redondo de gandola/cisterna, acostado (diámetro, largo)
--   cajon      : rectangular recto (ancho, alto, largo)
-- Los carros pequeños NO se cubican (tanque plástico moldeado, no entra la regla): de esos
-- solo la capacidad de la ficha, y el consumo se mide de carga a carga.
--
-- EL RADIO DE LA ESQUINA no se puede medir con cinta: se DEDUCE. Es el único valor que hace
-- que las tres medidas den la capacidad de fábrica. Si no existe ese valor, las medidas y la
-- capacidad no se corresponden y NO SE GUARDA la tabla — se vuelve a medir.
--
-- VERIFICADO: el motor (cubicacion.js, puro y testeable) reproduce el tanque del JAC que se
-- midió con cinta (60 x 52,5 x 199, 600 L de fábrica): deduce solo el radio de 12,54 cm y su
-- tabla coincide con la de Betangar al centilitro en todos los puntos probados.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.combustible_tanques_config add column if not exists forma text;
alter table public.combustible_tanques_config add column if not exists tabla_origen text;
alter table public.combustible_tanques_config add column if not exists tabla_desde timestamptz;
alter table public.combustible_tanques_config add column if not exists ancho_cm numeric;
alter table public.combustible_tanques_config add column if not exists alto_cm numeric;
alter table public.combustible_tanques_config add column if not exists largo_cm numeric;
alter table public.combustible_tanques_config add column if not exists radio_cm numeric;
alter table public.combustible_tanques_config add column if not exists diametro_cm numeric;
alter table public.combustible_tanques_config add column if not exists medido_por text;
alter table public.combustible_tanques_config add column if not exists medido_at timestamptz;

comment on column public.combustible_tanques_config.tabla_origen is
  'medida = aforo con bidón (lo único que es una medición de VOLUMEN) · calculada_de_medidas = geometría sobre el tanque real (cinta) · ficha = del fabricante · dividida = capacidad/altura, NO sirve para señalar a nadie.';
comment on column public.combustible_tanques_config.vehiculo_id is
  'A QUÉ UNIDAD pertenece este tanque. Una tabla describe UN tanque: no se comparte entre unidades salvo que sean el mismo modelo Y el mismo descriptor de VIN.';

-- La PWA del chofer (anon) lee SOLO el tanque de su unidad, no la tabla entera.
-- Si esa unidad no tiene tanque cubicado, devuelve NULL y el chofer guarda la medida en
-- centímetros SIN litros — en vez de convertirla con la tabla de otro carro.
create or replace function public.tanque_de_unidad(p_cam text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when t.id is null then null else jsonb_build_object(
    'tanque_id', t.id, 'nombre', t.nombre, 'forma', t.forma,
    'altura_max_cm', t.altura_max_cm, 'capacidad_litros', t.capacidad_litros,
    'tabla', t.tabla_cubicacion, 'tabla_origen', t.tabla_origen
  ) end
  from public.combustible_tanques_config t
  where t.vehiculo_id = p_cam and coalesce(t.activo,true) limit 1;
$$;
grant execute on function public.tanque_de_unidad(text) to anon, authenticated;

-- Verificado: tanque_de_unidad('FC09') devuelve el suyo; tanque_de_unidad('FC10') devuelve
-- NULL en vez de heredar el de FC09.

-- ════════════════════════════════════════════════════════════════════════════
-- Y LA REGLA DE CUÁNDO SE COMPARTE UNA TABLA (misma fecha)
-- Una tabla describe UN tanque. Pero 12 camiones IDÉNTICOS tienen el mismo tanque, y por eso
-- la tabla medida de Betangar les sirve a los 12. La regla no es "no compartir nunca": es
-- compartir SOLO cuando está comprobado que es el mismo carro —
--     mismo MODELO **y** mismo DESCRIPTOR DE VIN (posiciones 4 a 8, que describen modelo,
--     carrocería y motor).
-- Con esa regla la tabla del JAC de Betangar (VIN 8XR2RDH8…) NUNCA le calza a los "1131" de
-- Flotilla (VIN 8XR2YDHL…), que fue exactamente el error que se cometió hoy.
--
-- Verificado en Betangar: JAC-B001 y JAC-B012 resuelven a `tanque-jac` (600 L, de_modelo=true),
-- y una unidad IVECO de prueba devolvió NULL en vez de heredarlo.
alter table public.combustible_tanques_config add column if not exists modelo text;
alter table public.combustible_tanques_config add column if not exists vin_descriptor text;

update public.combustible_tanques_config
set modelo='HFC-1131KR1',
    vin_descriptor=(select substr(vin,4,5) from public.unidad_config where cam='JAC-B001'),
    ancho_cm=60, alto_cm=52.5, largo_cm=199, radio_cm=12.54,
    medido_por='Máximo (cinta)', medido_at='2026-07-25'
where id='tanque-jac';

-- tanque_de_unidad(cam): 1) el tanque de ESA unidad; 2) si no, el de su modelo comprobado por VIN.
-- (Definición completa en la migración aplicada `tanque_por_unidad_o_por_modelo_verificado`.)
