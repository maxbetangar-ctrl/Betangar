-- tanque_forma_origen_2026-07-25.sql   (Betangar — hrkjddehqnzcqwlkklqm)
--
-- POR QUÉ
-- El portón de la auditoría de combustible decidía si había aforo mirando UNA sola cosa: si la
-- tabla de cubicación tenía curva. La idea era cazar la tabla del JAC, que es 600 L ÷ 46 cm
-- repartido parejo — una división, no una medición.
--
-- El defecto: hay tanques en los que la tabla correcta ES una recta. Un tanque de cajón
-- (rectangular) da exactamente los mismos litros por centímetro en el fondo que arriba. Si el
-- tanque del JAC resulta ser de cajón, la tabla que hay estaría bien y el portón NUNCA abriría:
-- estaría bloqueando avisos legítimos para siempre por una regla que no aplica.
--
-- Lo que faltaba no era curva: era saber QUÉ FORMA tiene el tanque. Sin eso el sistema no puede
-- juzgar si su tabla lo describe. Estas dos columnas son ese dato.
--
--   forma         cilindro_horizontal | rectangular | rectangular_redondeado | irregular
--                 (NULL = nadie lo ha declarado)
--   tabla_origen  medida | calculada_de_medidas | calculada | fabricante   (NULL = no consta)
--
-- Cómo lo usa el portón después de esto:
--   tabla_origen='medida'                       -> vale, se aforó con volúmenes conocidos
--   tabla_origen='calculada_de_medidas'         -> vale, la geometría salió de medir el tanque
--   forma='rectangular'       + tabla recta     -> vale, la recta describe un cajón
--   forma='cilindro_...'      + tabla con curva -> vale, la curva describe un cilindro
--   forma='cilindro_...'      + tabla recta     -> NO (una división disfrazada)
--   forma NULL                                  -> NO (no se puede afirmar lo que no se sabe)
--
-- 'calculada' a secas NO alcanza: es una tabla sacada de la capacidad nominal sin haber tocado el
-- tanque. Es justo lo que tenía el JAC y lo que hay que dejar de aceptar.
--
-- Nada regresa: al no declarar forma en ninguna fila, el portón sigue cerrado igual que ayer.
-- Aditiva e idempotente.

alter table public.combustible_tanques_config
  add column if not exists forma        text,
  add column if not exists tabla_origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cbt_forma_chk') then
    alter table public.combustible_tanques_config
      add constraint cbt_forma_chk
      check (forma is null or forma in ('cilindro_horizontal','rectangular','rectangular_redondeado','irregular'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cbt_tabla_origen_chk') then
    alter table public.combustible_tanques_config
      add constraint cbt_tabla_origen_chk
      check (tabla_origen is null or tabla_origen in ('medida','calculada_de_medidas','calculada','fabricante'));
  end if;
end $$;

comment on column public.combustible_tanques_config.forma is
  'Forma física del tanque. El portón la necesita para juzgar si la tabla de cubicación lo describe: en un cajón la recta es correcta, en un cilindro acostado no.';
comment on column public.combustible_tanques_config.tabla_origen is
  'De dónde salió la tabla: medida (bidón de volumen conocido), calculada (geometría) o fabricante.';

-- Lo que SÍ consta hoy, verificado el 2026-07-25 y por eso se escribe:
-- los dos tanques de galpón usan una tabla que coincide al céntimo con la fórmula del segmento
-- circular de un cilindro de Ø109 cm y 2.300 L (comprobado punto por punto). Salió del Excel
-- Tabla_Cubicacion_Tanque.xlsx, generado con openpyxl el 19/06/2026 19:14 UTC y cargado a la base
-- ese mismo día 20:59 UTC. Es geometría, no medición.
update public.combustible_tanques_config
   set forma = 'cilindro_horizontal', tabla_origen = 'calculada'
 where id in ('tanque-galpon-1','tanque-galpon-2') and forma is null;

-- El tanque del JAC se deja en NULL A PROPÓSITO: su tabla es 13,04 L/cm parejo (600 ÷ 46) y nadie
-- ha declarado todavía si el tanque es redondo o de cajón. Mientras no conste, el portón no puede
-- afirmar que la tabla lo describe, y sigue cerrado. Se llena cuando Máximo confirme la forma.
