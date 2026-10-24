-- ════════════════════════════════════════════════════════════════════════════
--  EL CUADRE CUENTA DESDE QUE CADA UNIDAD EMPEZO, NO DESDE QUE EMPEZO EL REENVIO.
--
--  COMO APARECIO (24/10/2026). Al darle IMEI a B011 y B012 y arrancarlas limpias,
--  el cuadre del dia las marco **FALTAN 144** y **FALTAN 219**: cuenta todas las
--  posiciones del dia contra lo enviado, y de esas dos hay cientos de antes de
--  que entraran al reenvio. El numero es correcto y la conclusion es falsa.
--
--  ⛔ ES EL MISMO DEFECTO QUE YA SE ARREGLO UNA VEZ, EN CHICO. El 22/10, al
--     encender el reenvio, el cuadre grito «FALTAN 1.962» por las posiciones
--     previas; se arreglo con `configuracion.gps_reenvio_desde`, UN solo momento
--     para toda la flota. Hoy se ve el limite de ese arreglo: cada unidad puede
--     entrar al reenvio en un momento distinto, y una fecha global no puede
--     describir eso. No se parchea el caso: se corrige el mecanismo.
--     [[norma-arreglar-el-mecanismo-no-el-caso]]
--
--  ⚠️ Y UN AVISO QUE GRITA SIN MOTIVO ES PEOR QUE NO TENERLO: el cuadre existe
--     para ser la PRUEBA de exactitud ante la Alcaldia. Si marca «FALTAN» dos
--     unidades todos los dias por diseño, el dia que falte una de verdad nadie
--     va a mirar. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
-- ════════════════════════════════════════════════════════════════════════════

alter table gps_reenvio_estado add column if not exists reenvio_desde timestamptz;

comment on column gps_reenvio_estado.reenvio_desde is
  'Desde cuando esta unidad entra al reenvio. Nulo = desde que empezo el reenvio de la '
  'flota (configuracion.gps_reenvio_desde). Lo anterior a esta marca NO es un envio que '
  'falta: es tiempo en el que esta unidad todavia no se mandaba.';

do $do$
declare uid text; faltan int; cuadran int; k int;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- Las dos que entraron hoy arrancan hoy. ⛔ Se toma el cursor, que es el momento
  -- real en que empezaron, y no `now()`: si esto se corre mañana, `now()` diria
  -- otra cosa y el cuadre de hoy quedaria mal para siempre.
  update gps_reenvio_estado
     set reenvio_desde = enviado_hasta
   where cam in ('JAC-B011', 'JAC-B012')
     and reenvio_desde is null;

  -- ── EL CUADRE, AHORA POR UNIDAD ───────────────────────────────────────────
  create or replace function gps_reenvio_cuadre(p_desde date default (current_date - 7))
  returns table(cam text, f date, imei text, posiciones bigint, enviadas integer,
                fallidas integer, faltan bigint, estado text)
  language sql stable security definer set search_path to 'public'
  as $fn$
    with arranque as (
      select (select valor from configuracion where clave = 'gps_reenvio_desde')::timestamptz t
    ), pos as (
      select p.cam, (p.ts at time zone 'America/Caracas')::date f, count(*) n
        from gps_posiciones p
        left join gps_reenvio_estado s on s.cam = p.cam, arranque a
       where (p.ts at time zone 'America/Caracas')::date >= p_desde
         -- ⛔ Lo anterior a que ESTA unidad entrara no es un envio que falta.
         --    Manda su propia marca; si no tiene, la de la flota.
         and (coalesce(s.reenvio_desde, a.t) is null or p.ts >= coalesce(s.reenvio_desde, a.t))
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
  $fn$;

  -- ── CONTROLES ─────────────────────────────────────────────────────────────

  -- 1. Las dos quedaron con su marca.
  select count(*) into k from gps_reenvio_estado
   where cam in ('JAC-B011','JAC-B012') and reenvio_desde is not null;
  if k <> 2 then raise exception 'CONTROL: % de 2 unidades con su marca propia', k; end if;

  -- 2. ⛔ LA QUE DECIDE: hoy ya no pueden figurar como FALTAN. Es el motivo entero
  --    de esta migracion, y se comprueba contra la funcion de verdad.
  select count(*) into faltan from gps_reenvio_cuadre(current_date) where estado = 'FALTAN';
  if faltan > 0 then
    raise exception 'CONTROL: siguen % unidad(es) en FALTAN hoy; el cuadre sigue contando '
      'lo de antes de que entraran', faltan;
  end if;

  -- 3. ⛔ CONTROL POSITIVO, porque un cero tambien saldria si la funcion se
  --    rompio y no devuelve nada. Tiene que seguir viendo las 12 y diciendo que
  --    cuadran. [[norma-control-positivo-antes-de-creerle-al-vacio]]
  select count(*) into cuadran from gps_reenvio_cuadre(current_date) where estado like 'cuadra%';
  if cuadran <> 12 then
    raise exception 'CONTROL: solo % unidad(es) cuadran hoy, se esperaban 12', cuadran;
  end if;

  -- 4. Y el pasado NO se reescribe: los dias anteriores de las otras diez tienen
  --    que seguir contando igual que antes. Si esta migracion los cambiara,
  --    estariamos tapando envios que de verdad faltaron.
  select count(*) into faltan from gps_reenvio_cuadre(current_date - 2)
   where f < current_date and estado = 'FALTAN';
  if faltan > 0 then
    raise exception 'CONTROL: aparecieron % FALTAN en dias pasados: esta migracion no tenia '
      'que tocar el pasado', faltan;
  end if;

  raise notice 'OK - el cuadre cuenta desde que cada unidad entro. Hoy: 12 cuadran, 0 FALTAN.';
end $do$;
