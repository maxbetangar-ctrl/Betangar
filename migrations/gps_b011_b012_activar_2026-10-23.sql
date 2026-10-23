-- ════════════════════════════════════════════════════════════════════════════
--  B011 y B012: el proveedor ya las habilito, y NOSOTROS las estabamos tirando.
--
--  COMO APARECIO. Maximo, 23/10/2026: «puedes revisar porque hay 1 que se metio,
--  el gps pero no lo muestra... capaz y es algo tuyo que debes actualizar».
--  Tenia razon, y era peor de lo que creia: no es una, son LAS DOS.
--
--  LO MEDIDO (23/10/2026, `gps-diagnostico`, solo lectura):
--      A15EN3P (B011)  responseCode 100 · ValidGPS true · ignicion ON · odom 3.493 km
--      A07EV6P (B012)  responseCode 100 · ValidGPS true · ignicion ON · odom 1.226 km
--  Posicion valida y motor encendido: estaban trabajando mientras se medía. Los
--  odometros bajos coinciden con equipos recien instalados.
--
--  ⛔ EL CONECTOR LAS DESCARTABA A PROPOSITO. `gps-sondeo` lee
--     `gps_equipos?activo=is.true` y arma su indice SOLO con eso; lo que el API
--     devuelve y no esta en el indice va a `placas_ajenas` y se tira. Medido el
--     mismo dia: `sin_noticia: []`, `placas_ajenas: ["A15EN3P","A07EV6P"]` — el
--     proveedor mandaba las 12 y se guardaban 10.
--     Es la norma al reves: el dato llegaba y el filtro NUESTRO lo callaba.
--     [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
--  ⚠️ APARECEN EN NUESTRO MAPA, PERO TODAVIA NO EN EL DE LA ALCALDIA.
--     `gps-reenvio` filtra `activo=eq.true AND imei=not.is.null`, y estas dos
--     tienen `imei` en blanco: el IMEI del equipo nunca nos lo dieron. Hasta que
--     se cargue, Leonel sigue viendo 10. Esto NO es un olvido: el IMEI es el
--     identificador con el que IMAU Flota nombra a la unidad y escribirlo a ojo
--     mandaria las posiciones de un camion al nombre de otro.
--     [[norma-el-destino-de-un-mensaje-es-el-wid]]
--
--  ✅ Y NINGUNA ALARMA VA A GRITAR EN FALSO POR ESTO — verificado antes de
--     activar, no despues: `gps_reenvio_cuadre()` pregunta `when e.imei is null
--     then 'sin IMEI: no se manda'` ANTES que 'nada salio', y
--     `gps_reenvio_atraso()` filtra `e.activo and e.imei is not null`. Las dos
--     las dejan fuera sola. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
-- ════════════════════════════════════════════════════════════════════════════

update gps_equipos
   set activo = true
 where cam in ('JAC-B011', 'JAC-B012')
   and activo is not true;

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare uid text; act int; sin_placa int; n_atraso int; mal text;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- 1. Las doce, ni una mas ni una menos.
  select count(*) into act from gps_equipos where activo;
  if act <> 12 then
    raise exception 'CONTROL: quedaron % unidades activas, se esperaban 12', act;
  end if;

  -- 2. ⛔ El sondeo CASA POR PLACA: una unidad activa sin placa nunca recibiria
  --    dato y se veria igual que una unidad apagada. Si alguna quedo asi, esto
  --    no sirvio para nada y encima no se notaria.
  select count(*) into sin_placa from gps_equipos
   where activo and coalesce(placa_proveedor, placa, '') = '';
  if sin_placa > 0 then
    raise exception 'CONTROL: % unidad(es) activa(s) sin placa con que casar el dato del '
      'proveedor; esas nunca recibirian posicion y se verian igual que apagadas', sin_placa;
  end if;

  -- 3. Y LA QUE DECIDE: las dos recien activadas NO pueden haber entrado a la
  --    alarma de atraso del reenvio. Si entraron, mañana el aviso dice que el
  --    reenvio esta atrasado por dos unidades que nunca se mandaron, y un aviso
  --    que grita sin motivo deja de leerse.
  select count(*) into n_atraso from gps_reenvio_atraso()
   where cam in ('JAC-B011', 'JAC-B012');
  if n_atraso > 0 then
    raise exception 'CONTROL: B011/B012 entraron a gps_reenvio_atraso() sin tener IMEI; '
      'la alarma del reenvio va a gritar en falso todos los dias';
  end if;

  -- 4. Las dos tienen que haber quedado activas DE VERDAD.
  select string_agg(cam, ', ') into mal from gps_equipos
   where cam in ('JAC-B011','JAC-B012') and activo is not true;
  if mal is not null then raise exception 'CONTROL: % siguen inactivas', mal; end if;

  raise notice 'OK - 12 unidades activas. B011 y B012 entran al sondeo; al reenvio NO, '
    'hasta que tengan IMEI (y eso lo dice gps_reenvio_cuadre como "sin IMEI: no se manda").';
end $$;
