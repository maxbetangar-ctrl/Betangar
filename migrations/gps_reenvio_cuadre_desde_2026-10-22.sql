-- ════════════════════════════════════════════════════════════════════════════
--  El cuadre mide desde que el reenvío ARRANCÓ, no desde medianoche.
--
--  ⛔ POR QUÉ, Y SE VIO A LOS CINCO MINUTOS DE ENCENDER (22/10/2026). El reenvío
--     se encendió a las 13:08 UTC arrancando LIMPIO (decisión de Máximo: no
--     volcarle a la Alcaldía las 24 h acumuladas). Pero `gps_reenvio_cuadre`
--     compara contra TODAS las posiciones del día, así que contaba también las
--     ~190 por unidad de antes de encender y devolvía **«FALTAN» en las 10
--     unidades, 1.962 posiciones**.
--
--     El número era cierto y la conclusión falsa: no falta nada: esas posiciones
--     nunca se iban a mandar, por decisión. Y el parte diario de mañana a las
--     08:50 —el primero de verdad— habría llegado gritando una falla que no
--     existe. **Una alarma que miente el primer día no se vuelve a leer nunca.**
--     [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
--  ⛔ Y NO SE ARREGLA ESCONDIENDO EL HUECO. El cuadre sigue contando todo lo que
--     pasó DESPUÉS de encender, que es de lo único que el reenvío responde. Lo
--     de antes no se borra ni se maquilla: se deja afuera del cuadre y queda
--     dicho acá y en la propia función por qué.
-- ════════════════════════════════════════════════════════════════════════════

-- El instante en que el reenvío empezó a mandar. Si no existe, el cuadre se
-- comporta como antes (mide el día entero): no se inventa una fecha de arranque.
-- ⛔ EL ARRANQUE SE CALCULA DEL DATO, NO DEL RELOJ DE QUIEN CORRE ESTO.
--    La primera versión guardaba `now()` —el momento de correr la migración—,
--    siete minutos después de que el reenvío ya estuviera mandando. El cuadre
--    quedaba midiendo desde un instante en que todavía no había posiciones
--    nuevas y devolvía CERO filas. Lo cazó el control de abajo.
--    Lo correcto es la posición MÁS VIEJA QUE REALMENTE SALIÓ: para cada unidad,
--    retrocediendo tantas posiciones como dice su contador.
with vieja as (
  select e.cam,
         (select p.ts from gps_posiciones p
           where p.cam = e.cam and p.ts <= e.enviado_hasta
           order by p.ts desc
           offset greatest(e.enviadas_total - 1, 0) limit 1) ts
    from gps_reenvio_estado e
   where e.enviadas_total > 0
)
insert into configuracion (clave, valor)
select 'gps_reenvio_desde',
       to_char((min(ts) at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z'
  from vieja where ts is not null
 having min(ts) is not null
on conflict (clave) do update set valor = excluded.valor
 where configuracion.clave = 'gps_reenvio_desde';

create or replace function gps_reenvio_cuadre(p_desde date default (current_date - 7))
returns table (
  cam text, f date, imei text,
  posiciones bigint, enviadas integer, fallidas integer,
  faltan bigint, estado text
)
language sql stable security definer set search_path = public as $$
  with arranque as (
    select (select valor from configuracion where clave = 'gps_reenvio_desde')::timestamptz t
  ), pos as (
    select p.cam, (p.ts at time zone 'America/Caracas')::date f, count(*) n
      from gps_posiciones p, arranque a
     where (p.ts at time zone 'America/Caracas')::date >= p_desde
       -- ⛔ Solo lo de DESPUÉS de encender: de lo anterior el reenvío no responde.
       and (a.t is null or p.ts >= a.t)
     group by 1, 2
  )
  select pos.cam, pos.f, e.imei,
         pos.n, coalesce(d.enviadas, 0), coalesce(d.fallidas, 0),
         pos.n - coalesce(d.enviadas, 0),
         case
           when e.imei is null                       then 'sin IMEI: no se manda'
           when coalesce(d.enviadas, 0) = 0          then 'nada salió'
           when pos.n - coalesce(d.enviadas, 0) = 0  then 'cuadra'
           when pos.n - coalesce(d.enviadas, 0) <= 2 then 'cuadra (en camino)'
           else 'FALTAN'
         end
    from pos
    join gps_equipos e on e.cam = pos.cam
    left join gps_reenvio_dia d on d.cam = pos.cam and d.f = pos.f
   order by pos.f desc, pos.cam
$$;

comment on function gps_reenvio_cuadre(date) is
  'De cuántas posiciones salieron cuántas, por unidad y por día. ⛔ Cuenta solo desde '
  '`configuracion.gps_reenvio_desde`, el instante en que el reenvío empezó a mandar: lo '
  'anterior no se iba a mandar por decisión, y contarlo haría ver un hueco donde no lo hay. '
  'Si esa clave no existe, mide el día entero.';

revoke all on function gps_reenvio_cuadre(date) from anon;

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare n_faltan int; n_total int; hoy date := (now() at time zone 'America/Caracas')::date;
begin
  select count(*) into n_total from gps_reenvio_cuadre(hoy);
  if n_total = 0 then
    raise exception 'CONTROL: el cuadre no devolvió filas; antes devolvía 10';
  end if;

  -- ⛔ LA PRUEBA DEL ARREGLO: ya no puede decir que faltan 180 por unidad.
  select count(*) into n_faltan from gps_reenvio_cuadre(hoy) where faltan > 50;
  if n_faltan > 0 then
    raise exception 'CONTROL: % unidad(es) siguen con más de 50 posiciones «faltantes»: '
      'el cuadre sigue contando lo anterior al arranque', n_faltan;
  end if;

  raise notice 'OK · el cuadre mide desde el arranque · % filas', n_total;
end $$;
