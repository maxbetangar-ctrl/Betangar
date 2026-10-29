-- ════════════════════════════════════════════════════════════════════════════
--  LA ASIGNACIÓN DE CAMIONES QUEDA CONFIRMADA POR MÁXIMO.
--
--  Máximo, 29/10/2026: «confirma la asignacion de camiones como esta». Las 34
--  filas no cambian: lo que cambia es su ESTADO. Venían de una propuesta
--  automática —la que dejaba a más camiones en la zona donde ya trabajaban— y
--  ahora son la decisión del dueño.
--
--  ⛔ NO SE CIERRAN LAS FILAS PARA ABRIR OTRAS IGUALES. `desde` es cuándo ese
--     camión empezó en esa zona, y eso NO cambió hoy: el camión es el mismo.
--     Cerrar y reabrir inventaría un cambio de asignación que nunca ocurrió, y
--     mañana el historial diría que el 29/10 se movieron los 34 camiones.
--     Lo que hace falta es una columna aparte: CUÁNDO SE CONFIRMÓ, que es otra
--     pregunta que `desde` no puede contestar.
--     [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
--  ⛔ Y LA DISTINCIÓN NO ES BUROCRACIA. Dentro de un mes, mirando una zona que
--     no se recogió, hay que poder saber si ese camión estaba ahí porque lo
--     decidió Máximo o porque lo adivinó un script. Sin esta columna las dos
--     cosas se ven igual.
-- ════════════════════════════════════════════════════════════════════════════

alter table zona_asignacion add column if not exists confirmado_en  timestamptz;
alter table zona_asignacion add column if not exists confirmado_por text;

comment on column zona_asignacion.confirmado_en is
  'Cuándo una persona confirmó esta asignación. NULO = sigue siendo la propuesta '
  'automática y nadie la revisó. ⛔ No se confunde con `desde`, que es cuándo ese '
  'camión empezó en esa zona: una asignación puede llevar meses andando y no haber '
  'sido confirmada nunca.';
comment on column zona_asignacion.confirmado_por is
  'Quién la confirmó. Una decisión sin dueño no se puede discutir después.';

update zona_asignacion
   set confirmado_en  = now(),
       confirmado_por = 'Máximo Betancourt',
       nota = 'Confirmada por Máximo el 29/10/2026 tal como la propuso el sectorizador: '
              'la asignación que deja a más camiones en la zona donde ya venían trabajando, '
              'resuelta por día para que ninguno tenga dos zonas a la vez. Asignación FIJA.'
 where hasta is null;

-- ── CONTROLES ───────────────────────────────────────────────────────────────
do $$
declare n int; z int; choques int; sin_conf int;
begin
  select count(*) into n from zona_asignacion where hasta is null;
  select count(*) into z from zonas;
  select count(*) into sin_conf from zona_asignacion where hasta is null and confirmado_en is null;

  -- 1 · Una zona, un camión: todas las zonas con asignación vigente.
  if n <> z then
    raise exception 'CONTROL FALLIDO: % asignaciones vigentes para % zonas. Alguna quedó sin camión o con dos.', n, z;
  end if;
  if sin_conf > 0 then
    raise exception 'CONTROL FALLIDO: % asignaciones vigentes quedaron sin confirmar.', sin_conf;
  end if;

  -- 2 · ⛔ Ningún camión con dos zonas EL MISMO DÍA. Es el error que ya se
  --     cometió hoy (JAC-B008 en Olegario y Santa Lucía, las dos lunes y
  --     jueves) y lo que se confirma no puede volver a traerlo.
  select count(*) into choques
    from (select a.cam, a.parroquia, a.zona,
                 (select array_agg(distinct c.dia_semana) from cronograma_recoleccion c
                   where c.parroquia = a.parroquia
                     and c.vigente_desde = (select max(vigente_desde) from cronograma_recoleccion)) dias
            from zona_asignacion a where a.hasta is null) g1
    join (select a.cam, a.parroquia, a.zona,
                 (select array_agg(distinct c.dia_semana) from cronograma_recoleccion c
                   where c.parroquia = a.parroquia
                     and c.vigente_desde = (select max(vigente_desde) from cronograma_recoleccion)) dias
            from zona_asignacion a where a.hasta is null) g2
      on g2.cam = g1.cam and g2.parroquia > g1.parroquia and g1.dias && g2.dias;
  if choques > 0 then
    raise exception 'CONTROL FALLIDO: % camión(es) quedaron con dos zonas el mismo día.', choques;
  end if;

  raise notice 'CONTROL: % asignaciones confirmadas, una por cada una de las % zonas, 0 choques de día.', n, z;
end $$;
