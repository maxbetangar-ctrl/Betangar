-- ════════════════════════════════════════════════════════════════════════════
--  QUE UN DESCARTE SE ESCRIBA. El conector puede estar tirando posiciones y eso
--  se ve exactamente igual que todo en orden.
--
--  COMO APARECIO (23/10/2026). El proveedor habilito B011 y B012, empezaron a
--  reportar con posicion valida, y `gps-sondeo` las tiraba cada minuto porque no
--  estaban en `gps_equipos` como activas. El sondeo YA LO SABIA: calculaba
--  `placas_ajenas` y lo ponia en el JSON de su respuesta — una respuesta que
--  nadie lee nunca. No se guardaba, no avisaba, el vigilante no lo mira.
--  Resultado: NO SE PUEDE SABER CUANTOS DIAS ESTUVIMOS DESCARTANDO. El dato que
--  diria desde cuando es justo el que nunca se escribio.
--
--  ⛔ Y LA ASIMETRIA ESTABA ESCRITA EN EL PROPIO CODIGO. Tres lineas abajo del
--     descarte, para una unidad ACTIVA QUE NO VINO, el sondeo dice: «una ausencia
--     se ve igual que todo en orden si no se escribe» — y la escribe con
--     `marcarProblema`. Para la placa que SI vino y se tiro, solo hacia
--     `ajenas.push(placa)`. La ausencia se anotaba; el descarte, no.
--     [[norma-la-falta-de-un-dato-no-es-un-dato]]
--
--  No se arregla el caso (dos banderas en dos filas): se arregla el MECANISMO,
--  para que la proxima unidad que el proveedor habilite GRITE en vez de callarse.
--  [[norma-arreglar-el-mecanismo-no-el-caso]]
-- ════════════════════════════════════════════════════════════════════════════

-- ── ANOTAR ──────────────────────────────────────────────────────────────────
create or replace function gps_ajenas_anotar(p_placas text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare antes jsonb; nuevas jsonb; desde text;
begin
  -- Sin descartes: la marca se borra. ⛔ Tiene que auto-curarse, porque un aviso
  -- que se queda puesto despues de arreglado es la otra forma de mentir: el dia
  -- que vuelva a pasar de verdad, nadie le va a creer.
  if p_placas is null or array_length(p_placas, 1) is null then
    delete from configuracion where clave = 'gps_placas_descartadas';
    return;
  end if;

  nuevas := to_jsonb((select array_agg(x order by x) from unnest(p_placas) x));
  select valor::jsonb into antes from configuracion
   where clave = 'gps_placas_descartadas';

  -- ⛔ `desde` NO SE REESCRIBE si son las MISMAS placas. El sondeo corre cada
  --    minuto: refrescarlo siempre dejaria la antiguedad del descarte en «hace
  --    un minuto» para siempre, que es precisamente el dato que hoy no tenemos.
  --
  -- ⚠️ Y VA `clock_timestamp()`, NO `now()`. `now()` es la hora de ARRANQUE DE LA
  --    TRANSACCION y no se mueve adentro de ella: dos observaciones distintas en
  --    una misma transaccion quedarian con el mismo instante. Para una hora de
  --    OBSERVACION eso es falso, y el control de aca abajo —que anota, espera y
  --    vuelve a anotar— no podria distinguir un descarte nuevo de uno viejo.
  --    [[norma-una-medicion-tiene-hora]]
  desde := case when antes is not null and antes->'placas' = nuevas
                then antes->>'desde' else clock_timestamp()::text end;

  insert into configuracion (clave, valor, updated_at)
  values ('gps_placas_descartadas',
          jsonb_build_object('placas', nuevas, 'desde', desde,
                             'visto', clock_timestamp()::text)::text,
          now())
  on conflict (clave) do update
     set valor = excluded.valor, updated_at = now();
end $$;

comment on function gps_ajenas_anotar(text[]) is
  'Deja por escrito que el proveedor esta mandando placas que no tenemos registradas y '
  'cuyas posiciones se descartan. Con el array vacio borra la marca. `desde` conserva '
  'el momento en que empezo el descarte mientras las placas no cambien.';

-- ── LEER ────────────────────────────────────────────────────────────────────
create or replace function gps_descartes()
returns table(placas text[], desde timestamptz, horas numeric, visto timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  -- ⛔ Lectura de flota: pasa por la MISMA lista de roles que el resto del GPS.
  --    Una funcion `security definer` sin puerta se salta la RLS entera.
  perform gps_ve_o_falla();

  select valor::jsonb into v from configuracion where clave = 'gps_placas_descartadas';
  if v is null then return; end if;

  return query
  select array(select jsonb_array_elements_text(v->'placas')),
         (v->>'desde')::timestamptz,
         round(extract(epoch from (now() - (v->>'desde')::timestamptz)) / 3600.0, 1),
         (v->>'visto')::timestamptz;
end $$;

comment on function gps_descartes() is
  'Que placas esta descartando el conector y desde cuando. Vacio = no se esta descartando nada.';

grant execute on function gps_descartes() to authenticated;
revoke all on function gps_ajenas_anotar(text[]) from public, anon, authenticated;

-- ── CONTROL ─────────────────────────────────────────────────────────────────
do $$
declare uid text; n int; d1 timestamptz; d2 timestamptz; p text[];
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- Punto de partida: hoy no se descarta nada (se acaba de arreglar).
  perform gps_ajenas_anotar(array[]::text[]);
  select count(*) into n from gps_descartes();
  if n <> 0 then raise exception 'CONTROL: con el array vacio sigue reportando descartes'; end if;

  -- ⛔ CONTROL POSITIVO: antes de creerle a un «no hay descartes» hay que
  --    comprobar que este instrumento sabe contestar OTRA cosa. Un cero que
  --    tambien saldria estando roto no dice nada.
  --    [[norma-control-positivo-antes-de-creerle-al-vacio]]
  perform gps_ajenas_anotar(array['XYZ999','ABC111']);
  select count(*), min(desde) into n, d1 from gps_descartes();
  if n <> 1 then raise exception 'CONTROL: con 2 placas descartadas devolvio % filas', n; end if;
  select placas into p from gps_descartes();
  if not ('XYZ999' = any(p) and 'ABC111' = any(p)) then
    raise exception 'CONTROL: no devolvio las placas que se le anotaron: %', p;
  end if;

  -- Y LA QUE DECIDE: repetir las MISMAS placas no puede mover `desde`, o la
  -- antiguedad del descarte queda siempre en «recien» y se pierde lo unico que
  -- dice cuanto tiempo llevamos tirando datos.
  perform pg_sleep(1.2);
  perform gps_ajenas_anotar(array['ABC111','XYZ999']);   -- mismas, otro orden
  select desde into d2 from gps_descartes();
  if d2 <> d1 then
    raise exception 'CONTROL: `desde` se movio de % a % con las mismas placas; la antiguedad '
      'del descarte se reiniciaria en cada corrida del sondeo', d1, d2;
  end if;

  -- Pero si CAMBIAN, es otro descarte y `desde` si tiene que moverse.
  perform gps_ajenas_anotar(array['OTRA222']);
  select desde into d2 from gps_descartes();
  if d2 = d1 then
    raise exception 'CONTROL: cambiaron las placas descartadas y `desde` se quedo en la fecha '
      'del descarte anterior';
  end if;

  -- Se deja limpio: el estado real de hoy es que no se descarta nada.
  perform gps_ajenas_anotar(array[]::text[]);
  select count(*) into n from gps_descartes();
  if n <> 0 then raise exception 'CONTROL: quedo una marca de descarte de la propia prueba'; end if;

  raise notice 'OK - el descarte se escribe, se lee, conserva su antiguedad y se borra solo.';
end $$;
