-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Betangar · 2026-07-31 · La marca de "esta lectura fue corregida" tiene que SOBREVIVIR
--
-- POR QUÉ (cazado corriendo el banco de pruebas antes de subir nada):
-- La auditoría marcaba un día como `corregida` cuando encontraba DOS alturas distintas para el
-- mismo momento — y sobre los días corregidos las reglas de faltante NO opinan (con dos lecturas
-- que se contradicen no se puede afirmar nada de nadie). Esa marca no era un dato: era el efecto
-- secundario de que la fila vieja siguiera ahí.
--
-- Al colapsar los duplicados y poner el UNIQUE, esa señal desaparecía por dos lados:
--   · hacia atrás: julio pasó de 12 momentos corregidos a 0, y R1 saltó de 2 casos a 3 —
--     apareció JAC-B001 del 09/07 acusado de un faltante que ayer no existía. Limpiar la base
--     no puede volver culpable a nadie (misma lección que dejó la cubicación el 25/07).
--   · hacia adelante: con `upsert`, la corrección PISA la fila y las dos alturas ya no coexisten,
--     así que ningún día volvería a marcarse como corregido nunca más.
--
-- QUÉ HACE: la corrección pasa a ser una propiedad de la fila que queda, no un accidente de que
-- haya dos. Lo pone la BASE con un trigger, no la app: da igual quién escriba (chofer, oficina o
-- la edge), si la altura cambia la fila queda marcada.
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table public.combustible_mediciones
  add column if not exists corregida boolean not null default false;

comment on column public.combustible_mediciones.corregida is
  'La altura de esta lectura se cambió después de cargarla. Los días con lecturas corregidas no se usan para señalar faltantes de combustible.';

create or replace function public.comb_med_marca_corregida()
returns trigger language plpgsql as $$
begin
  if new.altura_cm is distinct from old.altura_cm then
    new.corregida := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_comb_med_corregida on public.combustible_mediciones;
create trigger trg_comb_med_corregida
  before update on public.combustible_mediciones
  for each row execute function public.comb_med_marca_corregida();

-- Backfill: los momentos que ANTES tenían dos alturas distintas quedan marcados igual que estaban.
update public.combustible_mediciones m
   set corregida = true
 where exists (
   select 1 from public.combustible_mediciones_dup_bkp b
    where b.vehiculo_id = m.vehiculo_id and b.fecha = m.fecha and b.momento = m.momento
      and b.altura_cm is distinct from m.altura_cm);
