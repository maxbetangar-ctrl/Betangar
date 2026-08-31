-- ═══════════════════════════════════════════════════════════════════════════════
-- gps_estado_para_proveedor — LO QUE SE LE PUEDE DECIR AL PROVEEDOR DE RASTREO,
-- medido, en SU grafía de placas.
--
-- POR QUÉ EXISTE. El 31/08 el contacto del proveedor preguntó por WhatsApp
-- «cuáles unidades presentaron irregularidad y si continúan con la falla». Esa
-- respuesta la tiene la base, no la memoria de nadie: son huecos de reporte con
-- el motor encendido, con hora y placa. Sin esta función, quien conteste —persona
-- o agente— tiene que recordar cifras, y una cifra recordada delante de un
-- proveedor es una cifra que se discute.
--
-- ⛔ LA PLACA VA EN LA GRAFÍA DEL PROVEEDOR (`placa_proveedor || placa`), la misma
--    regla que ya usa `gps-vigilante`. Mandarle la nuestra sería mandarle una
--    placa que en su sistema no existe: JAC-B008 es `A04EO1P` acá y `AO4E01P` allá.
--
-- ⛔ SOLO MOTOR ENCENDIDO. Con el motor apagado el equipo reporta cada 60 min a
--    propósito: contar esos huecos le mandaría al proveedor diez fallas por noche
--    que no son fallas. Medido: 10 huecos de 60 min entre la 1 y las 3 de la
--    madrugada de hoy, todos con ignición apagada y 0,00 km.
--    [[norma-la-premisa-antes-de-acusar]]
--
-- ⛔ NO DECIDE NADA NI MANDA NADA. Devuelve lo medido y se acabó; quién lo lee y
--    si sale hacia afuera lo decide quien la llama.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.gps_estado_para_proveedor(p_horas int default 24)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with p as (
    select pos.cam, pos.ts, pos.odometro,
           lag(pos.ts)        over (partition by pos.cam order by pos.ts) as ts_ant,
           lag(pos.ignicion)  over (partition by pos.cam order by pos.ts) as ign_ant,
           lag(pos.odometro)  over (partition by pos.cam order by pos.ts) as odo_ant
      from gps_posiciones pos
      join gps_equipos e on e.cam = pos.cam and e.activo
     where pos.ts > now() - (p_horas || ' hours')::interval
  ),
  huecos as (
    select coalesce(e.placa_proveedor, e.placa, p.cam) as placa,
           to_char(p.ts_ant at time zone 'America/Caracas', 'DD/MM HH24:MI') as se_calla,
           to_char(p.ts     at time zone 'America/Caracas', 'HH24:MI')       as vuelve,
           (extract(epoch from (p.ts - p.ts_ant)) / 60)::int as min,
           round((p.odometro - p.odo_ant)::numeric, 2) as km,
           p.ts as vuelve_ts
      from p join gps_equipos e on e.cam = p.cam
     where p.ts_ant is not null
       and p.ign_ant is true                    -- ⛔ ver la nota de arriba
       and p.ts - p.ts_ant >= interval '10 minutes'
  ),
  -- Quién está muda AHORA con el motor encendido. Se reusa la función que ya
  -- decide eso para la alarma de apagón: dos piezas que responden «quién está
  -- muda» tienen que responder lo mismo. [[norma-fuente-unica-datos]]
  mudas as (
    select coalesce(e.placa_proveedor, e.placa, m.cam) as placa, m.min_mudo
      from gps_mudas_andando(10, 5) m
      join gps_equipos e on e.cam = m.cam
  )
  select jsonb_build_object(
    'ahora',            to_char(now() at time zone 'America/Caracas', 'DD/MM HH24:MI'),
    'ventana_horas',    p_horas,
    'unidades_activas', (select count(*) from gps_equipos where activo),
    'reportando_ahora', (select count(distinct pos.cam) from gps_posiciones pos
                          join gps_equipos e on e.cam = pos.cam and e.activo
                         where pos.ts > now() - interval '15 minutes'),
    'mudas_ahora',      coalesce((select jsonb_agg(jsonb_build_object(
                            'placa', placa, 'min', min_mudo) order by min_mudo desc)
                          from mudas), '[]'::jsonb),
    'huecos',           coalesce((select jsonb_agg(jsonb_build_object(
                            'placa', placa, 'se_calla', se_calla, 'vuelve', vuelve,
                            'min', min, 'km', km) order by min desc)
                          from huecos), '[]'::jsonb),
    'huecos_n',         (select count(*) from huecos),
    'unidades_con_hueco', (select count(distinct placa) from huecos),
    'ultimo_hueco_cerro', (select to_char(max(vuelve_ts) at time zone 'America/Caracas',
                            'DD/MM HH24:MI') from huecos)
  );
$$;

comment on function public.gps_estado_para_proveedor(int) is
  'Huecos de reporte con MOTOR ENCENDIDO y estado actual, en la grafía de placas del proveedor. Solo lectura.';

revoke all on function public.gps_estado_para_proveedor(int) from public, anon;
grant execute on function public.gps_estado_para_proveedor(int) to service_role;
