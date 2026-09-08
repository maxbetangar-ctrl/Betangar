-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- LA SURTIDA QUE SE MANDA DOS VECES — el candado va en la PUERTA, no en el informe
--
-- 08/09/2026. La JAC-B009 tiene DOS surtidas de 350 L el 05/09, a las 18:08 y 18:28 (hora del
-- servidor), con FOTOS DISTINTAS: el chofer la mandó dos veces. 700 L en un tanque de 600 que
-- había salido con 297. Con esos 700 adentro, la auditoría le reclamó a una persona, con nombre y
-- apellido, 334,6 L de consumo de más. El duplicado no es un problema de papeleo: acusa a quien
-- trabajó bien.
--
-- ⛔ POR QUÉ NO ES UN `UNIQUE (cam, fecha)`. Porque DOS CARGAS EL MISMO DÍA SON NORMALES acá:
--    medido sobre las 86 surtidas, el 22/07 toda la flota cargó 120 + 80 L y el 28/07, 20 + 80 L.
--    Un único por día le prohibiría al chofer registrar la segunda carga real, y una carga que no
--    se puede registrar desaparece — que es peor que un duplicado, porque el duplicado se ve.
--    Es exactamente el error que ya tiene esta base en `checklist_fecha_cam_key`: un UNIQUE con una
--    fecha adentro afirma que eso pasa UNA vez al día, y Betangar hace viajes nocturnos.
--
-- ⛔ Y TAMPOCO ES `UNIQUE (cam, fecha, litros)`. En toda la historia el único par con los MISMOS
--    litros el mismo día es justo el duplicado, así que hoy no rompería nada — pero si mañana un
--    chofer carga 100 L en dos estaciones el mismo día, el candado le come la segunda. Además
--    exigiría borrar una de las dos filas de la B009 antes de poder crearse, y ESA fila tiene una
--    foto y plata detrás: cuál sobra lo decide quien opera, no una migración.
--
-- ⇒ LO QUE SÍ SE PUEDE AFIRMAR: un camión que acaba de recibir X litros NO PUEDE recibir otros X
--   litros una hora después. Tendría que haber quemado X en una hora, y un JAC 1131 quema del
--   orden de 40 L/h en el peor caso. La firma del reintento es esa: MISMO camión, MISMOS litros,
--   minutos de diferencia. Los dos duplicados reales estaban a 20 min (Betangar) y a 48 s (Flotilla).
--   NO se compara el tanque a propósito: si el chofer reintentó y de paso tocó otro botón de tanque,
--   sigue siendo la misma carga — y dos cargas iguales en una hora no caben vengan de donde vengan.
--   Una sola regla, idéntica en los 5 productos. [[norma-fuente-unica-datos]]
--   La ventana es de 1 hora: generosa para un reintento lento, imposible para una carga de verdad.
--
-- 📌 Y NO SE TIRA NADA: se devuelve el `id` de la que YA está registrada. La app lo reconoce, le
--    dice al chofer que su carga ya estaba y NO la vuelve a encolar. Un rechazo que se reencola
--    para siempre es un fallo disfrazado de éxito, que es justo lo que costó tres días en agosto.
--
-- La idempotencia de la COLA ya existe y no se toca: `on conflict (id) do update`. Esto es para el
-- otro caso, el que esa no cubre — el reintento HUMANO, que genera un `id` nuevo cada vez.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.surtida_registrar(p jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id text := coalesce(p->>'id','');
  v_lit numeric := coalesce(nullif(p->>'litros','')::numeric, 0);
  v_tanque text := coalesce(nullif(p->>'tanque',''),'principal');
  v_tasa numeric := nullif(p->>'tasa_bcv','')::numeric;
  v_cam text := p->>'cam';
  v_cap numeric;
  v_max numeric;
  v_cl numeric; v_cusd numeric; v_def boolean;
  v_dup text;
begin
  if v_id = '' then return null; end if;
  if v_lit <= 0 then return null; end if;

  -- ── LA MISMA CARGA, MANDADA DOS VECES ────────────────────────────────────────────────────────
  -- Se mira ANTES del tope por dedazo: si ya está registrada, no hay nada que validar.
  -- No se toca la fila que ya existe: se devuelve su `id` y se corta. Quien mandó dos veces se
  -- entera, y la carga real queda una sola vez.
  select s.id into v_dup
    from public.surtidas s
   where s.cam = v_cam
     and s.litros = v_lit
     and s.id <> v_id
     and s.created_at > now() - interval '1 hour'
   order by s.created_at desc
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICADA: esa carga de % L a % ya quedó registrada hace menos de una hora (%). No se cargó dos veces.',
      v_lit, v_cam, v_dup;
  end if;

  -- Tope POR UNIDAD segun su tanque (margen 50% por bidones/tanque auxiliar); si no hay capacidad
  -- cargada, el tope general de configuracion.
  v_max := coalesce((select nullif(trim(valor),'')::numeric from public.configuracion
                     where clave='surtida_litros_max' limit 1), 2000);
  select capacidad_tanque_l into v_cap from public.unidad_config where cam = v_cam;
  if v_cap is not null and v_cap > 0 then v_max := least(v_max, round(v_cap * 1.5)); end if;
  if v_lit > v_max then
    raise exception 'Litros invalidos: % L. A esta unidad le caben % L; el maximo por surtida es % L. Revisa el tipeo.',
      v_lit, coalesce(v_cap::text,'?'), v_max;
  end if;
  if v_tanque = 'estacion' then
    v_cl := null; v_cusd := 0; v_def := false;
  else
    select nullif(valor,'')::numeric into v_cl from public.configuracion where clave='tanque_costo';
    if v_cl is null or v_cl <= 0 then v_cl := 0.75; end if;
    v_cusd := round(v_lit * v_cl, 2); v_def := true;
  end if;
  insert into public.surtidas as s (
    id, fecha, hora, cam, chofer, tanque, litros, costo_litro_usd, costo_usd,
    tasa_bcv, costo_bs, foto_url, lat, lng, precision_gps, nota, token, costo_definido
  ) values (
    v_id, nullif(p->>'fecha','')::date, p->>'hora', v_cam, p->>'chofer',
    v_tanque, v_lit, v_cl, v_cusd,
    v_tasa, case when v_tasa is not null and v_cusd is not null then round(v_cusd*v_tasa,2) else null end,
    p->>'foto_url', nullif(p->>'lat','')::double precision, nullif(p->>'lng','')::double precision,
    nullif(p->>'precision_gps','')::double precision, p->>'nota', p->>'token', v_def
  )
  on conflict (id) do update set
    litros = excluded.litros, tanque = excluded.tanque,
    costo_litro_usd = excluded.costo_litro_usd, costo_usd = excluded.costo_usd,
    costo_definido = excluded.costo_definido,
    tasa_bcv = excluded.tasa_bcv, costo_bs = excluded.costo_bs,
    foto_url = excluded.foto_url, lat = excluded.lat, lng = excluded.lng,
    precision_gps = excluded.precision_gps, nota = excluded.nota
  where s.token is not distinct from (p->>'token') and s.costo_definido = false;
  return v_id;
end;
$function$;

-- El índice que hace barata la consulta del candado. NO es único a propósito: ver arriba.
create index if not exists idx_surtidas_cam_creado
  on public.surtidas (cam, created_at desc);
