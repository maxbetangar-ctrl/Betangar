-- ════════════════════════════════════════════════════════════════════════════
-- CUÁNTAS BATERÍAS LLEVA LA UNIDAD — se pregunta en la ficha
--
-- POR QUÉ: Máximo, 08/08/2026 — «muchos carros grandes usan 2 baterías y no 1
-- porque a veces son 24 voltios», y después: «eso deberías preguntarlo en la
-- ficha».
--
-- Sin este dato el sistema NO PUEDE saber si a una unidad le falta registrar la
-- segunda batería: ve una batería puesta y la da por completa. Con él, la ficha
-- avisa «lleva 2 y solo hay 1 registrada», y la plantilla de carga genera
-- exactamente las filas que esa unidad necesita.
--
-- ── POR QUÉ SE GUARDA LA CANTIDAD Y NO EL VOLTAJE ──────────────────────────
-- El voltaje hay que saberlo; la cantidad se CUENTA abriendo el capó. El que
-- llena la ficha —o el que está en el patio con el teléfono— puede contar. Y es
-- la cantidad, no el voltaje, lo que el sistema necesita para comparar contra
-- las piezas registradas. Se pone el voltaje en la ayuda del campo para que se
-- reconozca («los de 24 V llevan 2»), pero el dato que manda es el número.
-- [[norma-fuente-unica-datos]]
--
-- NULL = sin definir. No se asume 1: asumir sería tapar justo el caso que
-- queremos detectar. Mientras esté en null, el sistema no reclama nada.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.unidad_config
  add column if not exists baterias smallint;

comment on column public.unidad_config.baterias is
  'Cuántas baterías lleva la unidad (los de 24 V llevan 2, dos de 12 en serie). '
  'NULL = sin definir: el sistema no reclama faltantes hasta que alguien lo declare.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unidad_config_baterias_ck') then
    -- Un rango sensato: 0 (no lleva, ej. un remolque) hasta 4 (camiones grandes
    -- con cabina dormitorio). Fuera de eso es un error de tecleo.
    alter table public.unidad_config
      add constraint unidad_config_baterias_ck check (baterias is null or (baterias >= 0 and baterias <= 4));
  end if;
end $$;

-- La vista de lo que está puesto, ahora con lo que DEBERÍA estar. De acá sale
-- el aviso de «le falta una».
create or replace view public.v_piezas_faltantes
with (security_invoker = true) as
select
  u.cam,
  u.baterias                                    as esperadas,
  count(p.id)                                   as registradas,
  (u.baterias - count(p.id))                    as faltan,
  coalesce(string_agg(p.serial || ' (' || coalesce(nullif(p.posicion,''),'sin posición') || ')',
                      ' · ' order by p.posicion), '—') as puestas
from public.unidad_config u
left join public.piezas p
       on p.cam = u.cam and p.tipo = 'bateria' and p.fecha_retiro is null
where u.activo is not false
  and u.baterias is not null            -- sin declarar, no se reclama nada
group by u.cam, u.baterias
having count(p.id) < u.baterias;

comment on view public.v_piezas_faltantes is
  'Unidades a las que les falta registrar alguna batería: declararon que llevan N y hay menos puestas.';

revoke all on public.v_piezas_faltantes from anon;
grant select on public.v_piezas_faltantes to authenticated;
