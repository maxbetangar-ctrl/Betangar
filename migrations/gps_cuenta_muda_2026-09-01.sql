-- ════════════════════════════════════════════════════════════════════════════
--  gps_cuenta_muda — 01/09/2026
--
--  POR QUÉ EXISTE
--  Anoche a las 23:49 el proveedor dejó de listar la cuenta entera. A las 10:03
--  de hoy —10 h 20 min después— no había entrado UNA SOLA posición de NINGUNA de
--  las 10 unidades, y lo encontró Máximo mirando la pantalla, igual que el 31/08.
--
--  Las dos alarmas que ya existen NO PODÍAN VERLO, y hay que decir por qué:
--
--   · `gps_mudas_andando` (la alarma de apagón, nacida ayer) cuenta unidades
--     mudas CON EL MOTOR ENCENDIDO en su último reporte. Las 10 se callaron
--     estacionadas, entre las 22:51 y las 23:43. A las 10:03 devolvía **0**: con
--     la cuenta entera muerta, la flota se veía sana. El motor encendido es lo
--     que evita el aviso que salta todas las noches, y es justo lo que ciega a la
--     alarma cuando el corte empieza de noche.
--   · `gps-vigilante` unidad por unidad tiene umbral de 5 h y corre 10:40 y 17:40.
--     Iba a disparar hoy a las 10:40: 11 horas tarde, y con 10 avisos separados
--     mandando a revisar 10 aparatos que están sanos.
--
--  ⛔ EL SUJETO ES LA CUENTA, NO EL CAMIÓN — y por eso el instrumento es otro.
--  `gps_posiciones` no sirve para medir esto: con el motor apagado el equipo
--  reporta 1 vez por hora, así que la falta de posiciones de noche es normal.
--  Lo que NO tiene cadencia es el LISTADO: `gps-sondeo` pide toda la cuenta cada
--  minuto y el API contesta con todas las unidades, se hayan movido o no —
--  devuelve el último dato conocido. Cada unidad que viene en ese listado deja su
--  marca en `gps_sync_estado.ultimo_ok`, la escriba o no una posición nueva.
--
--  Por eso `ultimo_ok` es un latido de un minuto que NO depende del motor, ni de
--  la hora, ni de que el camión trabaje. Que se detenga es una sola cosa: el
--  proveedor dejó de entregar.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. ¿La cuenta está listando? ─────────────────────────────────────────────
--
--  ⛔ LA CONDICIÓN ES «NINGUNA», NO «UNA PROPORCIÓN», y es a propósito.
--  Si el proveedor lista ALGUNAS unidades y otras no, eso no es la plataforma
--  caída: es acceso perdido unidad por unidad, y de eso ya avisa el chequeo 3 de
--  `gps-vigilante` leyendo `gps_sync_estado.ultimo_error`. La oscuridad TOTAL es
--  lo único que no admite otra lectura, y es lo que se le reclama al proveedor.
--
--  ⚠️ `ultimo_ok` también se queda quieto si la unidad VINO en el listado pero su
--  dato era ilegible (sin `LastReported`), porque ese camino escribe el error y
--  no el ok. No se corrige: para lo que decide esta alarma —«no estamos
--  recibiendo la flota»— las dos cosas son la misma. Cuál de las dos fue lo dice
--  `ultimo_error`, que va en la copia de adentro.
create or replace function public.gps_cuenta_muda(p_min int default 15)
returns table (
  activas          int,   -- unidades activas en gps_equipos
  listadas         int,   -- de ésas, cuántas listó la cuenta dentro de la ventana
  ultimo_listado   timestamptz,
  min_sin_listar   int,
  muda             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select g.cam, s.ultimo_ok
      from gps_equipos g
      left join gps_sync_estado s on s.cam = g.cam
     where g.activo
  )
  select count(*)::int,
         count(*) filter (where ultimo_ok > now() - (p_min || ' minutes')::interval)::int,
         max(ultimo_ok),
         (extract(epoch from (now() - max(ultimo_ok))) / 60)::int,
         -- Muda = hay unidades activas, ninguna fue listada en la ventana, y
         -- alguna vez se listó. ⛔ Sin ese último requisito, una base recién
         -- clonada —donde nunca hubo un solo sondeo— nacería gritando apagón.
         (count(*) > 0
          and count(*) filter (where ultimo_ok > now() - (p_min || ' minutes')::interval) = 0
          and max(ultimo_ok) is not null)
    from e;
$$;

comment on function public.gps_cuenta_muda(int) is
  'Si el proveedor dejó de listar la cuenta ENTERA. Mide gps_sync_estado.ultimo_ok, que es el latido del LISTADO (un minuto) y no del camión: no depende del motor ni de la hora. La usa gps-vigilante?modo=apagon.';

--  ⛔ SOLO `service_role`. La pantalla del mapa también necesita saber esto para
--  decir por qué está vacía, pero NO se le abre esta función a `authenticated`:
--  es `security definer` y atraviesa el RLS, así que dársela a todo usuario
--  logueado le daría el estado del rastreo también a un chofer. La pantalla lo
--  lee de `gps_sync_estado` bajo su propio RLS — ver el punto 3.
revoke all on function public.gps_cuenta_muda(int) from public, anon;
grant execute on function public.gps_cuenta_muda(int) to service_role;


-- ── 2. El umbral, en la configuración y no en el código ──────────────────────
--
--  ⚠️ MEDIDO, Y MEDIDO SOBRE EL INSTRUMENTO QUE USA LA ALARMA — que es la
--  comprobación que faltó ayer y fijó el umbral del apagón en un número que no se
--  alcanzaba nunca en vivo. La pregunta que hay que hacerse siempre:
--  ¿este umbral habría disparado en el caso que originó el trabajo?
--
--    · El LISTADO no tiene huecos: `ultimo_ok` de las 10 unidades avanzó cada
--      minuto sin interrupción hasta las 23:49 de anoche. No hay un solo corte
--      previo que 15 minutos convierta en falso positivo.
--    · Para comparar: el silencio más largo de POSICIONES de toda la flota, en
--      los 2 días y medio con las 10 unidades, fue de 19 minutos (madrugada,
--      motores apagados). Ése es el número que haría ruido si se midiera por
--      posiciones — otra razón para no medir por ahí.
--    · Con 15 minutos, el apagón de anoche disparaba a las **00:04**. Máximo lo
--      vio a las 10:03. Diez horas de flota a ciegas que nadie supo.
--
--  15 minutos son 15 listados fallidos seguidos: holgado para un tropiezo del
--  proveedor, y aun así diez horas antes que lo que había.
insert into public.configuracion (clave, valor)
values ('gps_cuenta_muda_min', jsonb_build_object('minutos', 15)::text)
on conflict (clave) do update set valor = excluded.valor, updated_at = now();


-- ── 3. Que la pantalla pueda decir POR QUÉ está vacía ────────────────────────
--
--  `gps_sync_estado` se podía leer con 4 roles (superadmin, admin, directivo,
--  auditor) mientras `gps_posiciones` se puede leer con 9. O sea: el operador que
--  mira el mapa veía el mapa vacío y NO podía leer la explicación de por qué
--  estaba vacío. Ése es exactamente el defecto del 29/08 —un «no podés»
--  disfrazado de «no hay nada»— pero al revés: la explicación desaparecía justo
--  para quien la necesita.
--
--  Se alinean las dos listas. La tabla no guarda nada personal ni de dinero: es
--  la salud del rastreo. Quien puede ver dónde está el camión puede saber desde
--  cuándo no se sabe dónde está.
--  ⛔ Se ALTERA la policy, no se borra y se vuelve a crear. Entre el `drop` y el
--  `create` la tabla queda sin ninguna policy de SELECT, y si el segundo comando
--  falla se queda así: nadie puede leerla. `alter policy` no abre esa ventana.
alter policy gps_sync_estado_sel on public.gps_sync_estado
  using (app_rol() = any (array[
    'superadmin','admin','operador','visualizador',
    'directivo','auditor','revisor','operativo','mecanico'
  ]));
