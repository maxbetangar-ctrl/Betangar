-- ═══════════════════════════════════════════════════════════════════════════════
-- km_data.estado_desde: la fecha REAL en que la unidad salió de circulación
-- 2026-08-10
--
-- QUÉ PASÓ
--   El dashboard mostraba «B004 — TALLER · 22d». En esos 22 días la B004 hizo
--   21 planillas y 47 viajes, con chofer casi todos los días. El número era falso.
--
--   La causa: `chofer.html` escribía `km_data.estado` y NUNCA `estado_desde`.
--   El 20/07 un backfill puso `estado_desde=2026-07-20`; el 21/07 el chofer la
--   marcó operativa desde el celular y la fecha quedó clavada (no se nota, porque
--   los días solo se pintan si la unidad NO está operativa); el 09/08 volvió a
--   taller y el contador resucitó una fecha de julio.
--   El código ya está arreglado (chofer.html: `_kmDataAplicarEstado`). Esto
--   corrige el DATO que quedó mal.
--
-- CÓMO SE CALCULA LA FECHA REAL — no se escribe a mano
--   Es la primera fecha de la RACHA ACTUAL de checklists no-operativos: se mira
--   hacia atrás desde el último checklist y se corta en el primer 'operativo'.
--   Sobre los datos de hoy da: B001 → 10/07 (la que ya tenía: correcta),
--   B004 → 09/08 (tenía 20/07: 21 días de más). Es decir, la consulta se valida
--   sola contra la unidad que sí estaba bien.
--
-- Y `estado_confirmado`
--   El backfill lo dejó en TRUE. Ese campo significa «una persona de oficina
--   verificó por qué está fuera», y sirve para decidir si el modal
--   «¿por qué están fuera estas unidades?» le pregunta al superadmin
--   (regla: esSuper ? !confirmado : !nota). Un TRUE puesto por un script apaga
--   la pregunta que el sistema debería hacer: la B004 lleva 21 días sin que nadie
--   le pida cuentas al número. Se baja a FALSE en todo lo que confirmó el backfill.
--   [[norma-estado-unidad-lo-declara-una-persona]] [[norma-fuente-unica-datos]]
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) estado_desde = inicio de la racha actual fuera de circulación ────────────
with rk as (
  select cam, fecha,
         case when estado_vehiculo = 'operativo' then 1 else 0 end as op,
         row_number() over (partition by cam order by fecha desc) as rn
  from checklist
),
corte as (   -- rn del checklist OPERATIVO más reciente: la racha va de rn=1 hasta ahí-1
  select cam, coalesce(min(rn) filter (where op = 1), 999999) as rn_op
  from rk group by cam
),
racha as (
  -- `checklist.fecha` es TEXT y `km_data.estado_desde` es DATE: el cast es obligatorio
  -- (sin él: «operator does not exist: date = text»).
  select rk.cam, min(rk.fecha)::date as desde_real
  from rk join corte c using (cam)
  where rk.op = 0 and rk.rn < c.rn_op
  group by rk.cam
)
update km_data k
   set estado_desde = r.desde_real,
       updated_by   = 'fix estado_desde 2026-08-10 (racha real de checklists)'
  from racha r
 where r.cam = k.cam
   and k.estado is distinct from 'operativo'
   and k.estado_desde is distinct from r.desde_real;

-- ── 2) Fuera de circulación pero OPERATIVA en km_data: la fecha no aplica ───────
--     (contador colgado que reaparece la próxima vez que la unidad salga)
update km_data
   set estado_desde = null
 where estado = 'operativo'
   and estado_desde is not null;

-- ── 3) El motivo lo escribió el chofer en el checklist, no en km_data ───────────
--     Sin esto la tarjeta sale amarilla y sin una palabra que la explique.
update km_data k
   set nota_estado = c.observaciones
  from (
    select distinct on (cam) cam, observaciones
      from checklist
     where estado_vehiculo is distinct from 'operativo'
       and coalesce(trim(observaciones), '') <> ''
     order by cam, fecha desc
  ) c
 where c.cam = k.cam
   and k.estado is distinct from 'operativo'
   and coalesce(trim(k.nota_estado), '') = '';

-- ── 4) Solo lo que estaba MAL vuelve a preguntarse ─────────────────────────────
--     Primera versión de este paso: bajar `estado_confirmado` en TODO lo que venía del backfill.
--     Mal. Eso agarraba también a la B001, que está bien: su fecha (10/07) es la real —última
--     planilla y último checklist ese mismo día, no se movió más— y su motivo está escrito
--     («problemas de electricidad del tablero»). Bajarle el confirmado solo lograba que el modal
--     «¿por qué están fuera estas unidades?» volviera a preguntar por una unidad que ya estaba
--     explicada. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
--     La 4 tenía 47 viajes en los días que decía estar en taller; la 1 no tiene ni uno. Solo se
--     reabre la pregunta donde la fecha se CORRIGIÓ, o sea las filas que tocó el paso 1.
update km_data
   set estado_confirmado = false
 where estado_confirmado = true
   and updated_by = 'fix estado_desde 2026-08-10 (racha real de checklists)';

commit;

-- ── Verificación (debe devolver 0 filas) ───────────────────────────────────────
-- Ninguna unidad fuera de circulación puede tener una fecha ANTERIOR a su última
-- planilla: si trabajó después, la fecha miente. Es el cruce que nadie hacía.
--
--   select k.cam, k.estado, k.estado_desde, max(p.f) as ultima_planilla
--     from km_data k join planillas p on p.cam = k.cam
--    where k.estado is distinct from 'operativo' and k.estado_desde is not null
--    group by k.cam, k.estado, k.estado_desde
--   having max(p.f)::date > k.estado_desde;
