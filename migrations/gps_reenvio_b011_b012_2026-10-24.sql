-- ════════════════════════════════════════════════════════════════════════════
--  QUE LA ALCALDIA VEA LOS 12 CAMIONES.
--
--  PEDIDO (Maximo, 24/10/2026): «necesito que Leonel vea los 12 camiones».
--  Desde el 23/10 las doce unidades reportan en NUESTRO mapa, pero a IMAU Flota
--  solo salian diez: `gps-reenvio` filtra `activo = true AND imei is not null`, y
--  a B011/B012 les faltaba el IMEI.
--
--  📌 Y EL IMEI NO HABIA QUE PEDIRSELO A NADIE: ya lo estabamos recibiendo. El
--     proveedor lo manda en cada posicion (`gps_posiciones.id_equipo`) y asi se
--     llenaron los otros diez el 21/10. Hasta ayer esas dos unidades no tenian
--     posiciones, asi que no habia de donde sacarlo. Hoy sobran.
--     ⛔ Por eso se vuelve a llenar DESDE LO MEDIDO y no a mano: un IMEI tecleado
--        puede estar mal escrito y nadie lo nota hasta que la Alcaldia reclame
--        que le falta un camion. [[norma-el-destino-de-un-mensaje-es-el-wid]]
--
--  LO MEDIDO ANTES DE TOCAR NADA (24/10):
--      JAC-B011  436 posiciones · 436 con id de 15 digitos · UN solo id distinto
--      JAC-B012  513 posiciones · 513 con id de 15 digitos · UN solo id distinto
--  Ni una posicion sin id, ni un id que cambie. No hay ambiguedad que resolver.
--
--  ⛔ ARRANQUE LIMPIO, COMO SE HIZO CON LAS DIEZ. El cursor nace en `now()`, no
--     al principio: hay ~950 posiciones acumuladas de estas dos unidades y
--     volcarselas de golpe al servidor de la Alcaldia es exactamente lo que se
--     prometio por escrito que no se iba a hacer. Si despues quieren el
--     historico, se pide y se manda, no se sorprende a nadie.
--
--  ⚠️ El reenvio YA estaba protegido de este error: una unidad sin fila de cursor
--     se saltea con «sin fila de cursor», no se vuelca. El arranque limpio es
--     para que ademas no quede reportando un error todos los minutos.
-- ════════════════════════════════════════════════════════════════════════════

do $do$
declare uid text; n_imei int; dup int; k int; viejas int; sin_cursor int;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- ── 1. El IMEI, desde lo que el proveedor manda ───────────────────────────
  update gps_equipos e
     set imei = (select p.id_equipo
                   from gps_posiciones p
                  where p.cam = e.cam
                    and p.id_equipo ~ '^[0-9]{15}$'
                  order by p.ts desc
                  limit 1)
   where e.imei is null
     and e.cam in ('JAC-B011', 'JAC-B012');

  -- ── 2. El cursor, arrancando AHORA ────────────────────────────────────────
  --
  -- ⛔ LAS FILAS YA EXISTIAN, Y ESO ERA LA TRAMPA. Se crearon el 22/10 09:07 al
  --    encender el reenvio, para las doce. Como estas dos nunca mandaron nada
  --    (sin IMEI no entran al filtro), quedaron quietas con `enviadas_total = 0`
  --    y acumulando: al medir habia 438 + 515 = 953 POSICIONES PENDIENTES.
  --    Poner el IMEI sin tocar el cursor le volcaba las 953 de golpe al servidor
  --    de la Alcaldia en la siguiente corrida — exactamente lo que se prometio
  --    por escrito que no se iba a hacer.
  --    Lo cazo el control de abajo, no yo: la primera version solo insertaba
  --    filas que faltaban, y como no faltaba ninguna no hacia nada.
  --
  -- ⛔ MOVER UN CURSOR HACIA ADELANTE ES DECIR «ESTO YA SE MANDO», y eso casi
  --    nunca es legitimo. Aca lo es, y por dos razones que hay que poder
  --    sostener: de estas dos unidades NO SE MANDO NUNCA NADA (`enviadas_total`
  --    en 0, sin un solo intento), asi que no se esta tapando un envio fallido;
  --    y el arranque limpio es la MISMA decision que se tomo y se comunico el
  --    22/10 para las otras diez. El historico sigue entero en nuestra base: si
  --    la Alcaldia lo pide, se manda. No se pierde, se decide no sorprenderlos.
  insert into gps_reenvio_estado (cam, enviado_hasta, intentos_fallidos, enviadas_total)
  select e.cam, now(), 0, 0
    from gps_equipos e
   where e.cam in ('JAC-B011', 'JAC-B012')
     and not exists (select 1 from gps_reenvio_estado s where s.cam = e.cam);

  update gps_reenvio_estado
     set enviado_hasta = now()
   where cam in ('JAC-B011', 'JAC-B012')
     and enviadas_total = 0;      -- ⛔ solo si NUNCA se mando nada de esa unidad

  -- ── CONTROLES ─────────────────────────────────────────────────────────────

  -- 3. Las doce tienen IMEI.
  select count(*) into n_imei from gps_equipos where activo and imei is not null;
  if n_imei <> 12 then
    raise exception 'CONTROL: % unidades activas con IMEI, se esperaban 12', n_imei;
  end if;

  -- 4. ⛔ LA QUE DECIDE, Y NO ES UNA FORMALIDAD: NINGUN IMEI REPETIDO. El IMEI es
  --    el nombre con el que IMAU Flota identifica la unidad. Dos camiones con el
  --    mismo numero no dan error en ninguna parte: hacen que las posiciones de
  --    uno aparezcan bajo el nombre del otro, y eso la Alcaldia lo lee como que
  --    un camion estuvo donde nunca estuvo. Es el peor defecto posible en esto,
  --    porque se ve perfectamente bien.
  select count(*) into dup from (
    select imei from gps_equipos where imei is not null group by imei having count(*) > 1) x;
  if dup > 0 then
    raise exception 'CONTROL: % IMEI repetido(s) entre unidades. La Alcaldia veria las '
      'posiciones de un camion bajo el nombre de otro', dup;
  end if;

  -- 5. El IMEI guardado tiene que ser EL QUE EL PROVEEDOR MANDA, y uno solo.
  --    Si una unidad hubiera mandado dos ids distintos, le cambiaron el aparato
  --    y copiar «el ultimo» a ciegas seria elegir sin mirar.
  select count(*) into k from (
    select p.cam from gps_posiciones p
     where p.cam in ('JAC-B011','JAC-B012') and p.id_equipo is not null
     group by p.cam having count(distinct p.id_equipo) > 1) y;
  if k > 0 then
    raise exception 'CONTROL: % unidad(es) mandaron mas de un id de aparato; hay que mirar '
      'cual es antes de declararlo', k;
  end if;
  if exists (select 1 from gps_equipos e
              where e.cam in ('JAC-B011','JAC-B012')
                and e.imei is distinct from (select p.id_equipo from gps_posiciones p
                                              where p.cam = e.cam and p.id_equipo is not null
                                              order by p.ts desc limit 1)) then
    raise exception 'CONTROL: el IMEI guardado no coincide con el que manda el proveedor';
  end if;

  -- 6. ⛔ ARRANQUE LIMPIO: el cursor no puede quedar en el pasado, o la proxima
  --    corrida le vuelca ~950 posiciones viejas a un servidor ajeno.
  select count(*) into viejas
    from gps_reenvio_estado
   where cam in ('JAC-B011','JAC-B012') and enviado_hasta < now() - interval '5 minutes';
  if viejas > 0 then
    raise exception 'CONTROL: % cursor(es) arrancan en el pasado: la proxima corrida le '
      'volcaria el historico acumulado a la Alcaldia', viejas;
  end if;

  -- 7. Y ninguna unidad activa puede quedarse sin cursor: esa se saltearia en
  --    silencio y la Alcaldia volveria a ver once.
  select count(*) into sin_cursor
    from gps_equipos e
   where e.activo and not exists (select 1 from gps_reenvio_estado s where s.cam = e.cam);
  if sin_cursor > 0 then
    raise exception 'CONTROL: % unidad(es) activas sin fila de cursor', sin_cursor;
  end if;

  raise notice 'OK - las 12 unidades con IMEI y con cursor. B011 y B012 arrancan desde ahora, '
    'sin volcar historico.';
end $do$;
