-- ═══════════════════════════════════════════════════════════════════════════════
-- PIEZAS 3 Y 4 · «PASÓ EL TOPE» NO ES UNA SOLA COSA, Y EL AVISO NO PUEDE CALLARSE
--
-- ✅ LO PRIMERO, QUE SE MIDIÓ ANTES DE TOCAR NADA: **el aviso YA EXISTÍA Y FUNCIONÓ.**
--    El 06/10/2026 a las 11:56:03, al minuto de la primera lectura trancada del FC17, salió
--    a `mant_aprobador_tel` (+584146153554, Carlos Serrano) y quedó `enviado`:
--      «Sr. Carlos, la unidad FC17 está marcando 32 cm con la regla, pero el tanque según la
--       configuración mide 27 cm de alto. ¿Puede revisarlo y ajustarlo…?»
--    Y a las 13:08 salió otro igual por el FC13. O sea que el guardián disparó, nombró la
--    unidad, nombró los dos números y llegó a la persona correcta. **No hacía falta construirlo.**
--    ⇒ Lo que falló fue lo que el aviso DICE y lo que hace después. Esto es eso.
--
-- 🔴 DEFECTO 1 · APUNTA AL TANQUE, NO A LA CONFIGURACIÓN. Dice «el tanque según la
--    configuración mide 27 cm» y a renglón seguido pide «revisarlo y ajustarlo»: quien lo lee
--    entiende «andá a ver el camión», cuando lo que está mal es el NÚMERO en el sistema. Y
--    «para mejorar el funcionamiento» lo hace sonar opcional.
--
-- 🔴 DEFECTO 2 · NO DICE LO QUE CUESTA. Mientras el tope esté corto esa unidad **no produce
--    litros** y su consumo queda afuera de la auditoría de combustible. Eso es lo que hace que
--    alguien se mueva; sin eso es un mensaje más.
--
-- 🔴 DEFECTO 3 · SE CALLA UN MES. El `ref` llevaba el mes adentro: UN aviso por unidad por mes.
--    Un aviso que dispara una vez y se queda callado **no se distingue de un problema resuelto**.
--    El FC17 pasó 46 h mudo después de ese único mensaje. Ahora insiste UNA VEZ POR DÍA mientras
--    el problema siga, dice cuántos días lleva, y **se apaga solo** cuando se corrige.
--
-- 🔴 DEFECTO 4 (pieza 4) · «PASÓ EL TOPE» METÍA TRES COSAS DISTINTAS POR LA MISMA PUERTA.
--    Medido el 07/10 en FLOTILLA, la lectura más alta de cada unidad contra su propio tope:
--      FC14 **7.129 cm** (tope 27) · FC01 **600** (tope 67 — y 600 L es su capacidad) ·
--      FC16 525 (tope 83) · FC12 180 (tope 72) · FL01 **75** y FL02 **76** (tope 48, y la
--      capacidad de los dos es 76,8 L).
--    O sea: **la gente teclea LITROS en el campo de CENTÍMETROS.** Si eso entra por la misma
--    puerta que una regla que de verdad recorre más, el aviso sale diciendo «la unidad está
--    marcando 7.129 cm» y nadie le cree nunca más — y encima el historial queda inservible
--    como testigo. Ahora se distinguen tres casos, por el DATO y no por un porcentaje inventado:
--
--      'imposible'      → más de 260 cm. Es el MISMO tope que ya usa `cubicacion.js` para
--                         cargar un tanque (TQ_LIMITES.alto_cm.max): no hay tanque de camión de
--                         2,6 m de profundidad, así que eso no es una medida de regla.
--      'parece_litros'  → cae a menos del 5% de la CAPACIDAD en litros de ese mismo tanque.
--                         Que el número coincida con los litros no es casualidad.
--      'sobre_el_tope'  → lo demás, y es el único que avisa: la regla puede estar recorriendo
--                         más de lo configurado, que es lo que le pasó al FC17 (48 contra 27).
--
-- ⛔ LO QUE NO SE TOCA, Y ES A PROPÓSITO: **la medición del chofer SIEMPRE se guarda**, en los
--    tres casos. Un `raise` acá no protege nada: el chofer corre offline-first y el código
--    encola y reintenta para siempre, así que un rechazo de la base se convierte en una cola
--    trabada y en silencio. Lo que SÍ cambia es que `imposible` y `parece_litros` **no mandan
--    aviso** (no son un tope corto) y quedan con un motivo que dice qué se sospecha.
--    El «escribilo otra vez» va en la PANTALLA, que es donde la persona puede corregir.
--
-- ⛔ Y NO SE INVENTAN LITROS en ninguno de los tres: `litros_calculados` queda en null.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.chofer_medicion_guardar(p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_veh    text    := p->>'vehiculo_id';
  v_alt    numeric := case when p ? 'altura_cm' and coalesce(p->>'altura_cm','') <> ''
                           then (p->>'altura_cm')::numeric else null end;
  v_lit    numeric := case when p ? 'litros_calculados' and coalesce(p->>'litros_calculados','') <> ''
                           then (p->>'litros_calculados')::numeric else null end;
  v_gracia numeric := 2;                       -- = CL_ALTURA_GRACIA_CM en chofer.html
  v_regla_max numeric := 260;                  -- = TQ_LIMITES.alto_cm.max en cubicacion.js
  v_tope   numeric;
  v_cap    numeric;
  v_clase  text    := null;                    -- null | imposible | parece_litros | sobre_el_tope
  v_over   boolean := false;
  v_motivo text    := null;
  v_dias   int;
  v_tel    text; v_trato text; v_ref text; v_msg text;
begin
  if coalesce(p->>'vehiculo_id','') = '' or coalesce(p->>'fecha','') = ''
     or coalesce(p->>'momento','') = '' then
    raise exception 'vehiculo_id, fecha y momento son obligatorios';
  end if;
  if not public.chofer_puede_ver(p->>'vehiculo_id') then
    raise exception 'esa unidad no es la suya';
  end if;

  -- El tope REAL de la REGLA de esta unidad y la capacidad de su tanque (null si la unidad no
  -- tiene tanque configurado —IVECO, etc.—: ahí nunca se marca ni se avisa).
  select altura_max_cm, capacidad_litros into v_tope, v_cap
    from public.combustible_tanques_config
   where vehiculo_id = v_veh and coalesce(activo, true)
   order by altura_max_cm desc nulls last
   limit 1;

  -- ── Los TRES casos, y cuál de ellos merece un aviso ───────────────────────
  if v_alt is not null and v_tope is not null and v_alt > v_tope + v_gracia then
    v_lit := null;                             -- en ninguno de los tres se inventan litros
    if v_alt > v_regla_max then
      v_clase  := 'imposible';
      v_motivo := 'lectura de ' || v_alt || ' cm: son ' || round(v_alt/100, 1)
               || ' m y ninguna regla de tanque de camión llega a eso — número mal escrito';
    elsif v_cap is not null and v_cap > 0 and abs(v_alt - v_cap) <= v_cap * 0.05 then
      v_clase  := 'parece_litros';
      v_motivo := 'lectura de ' || v_alt || ' cm con el tope en ' || v_tope
               || ' cm, y la capacidad del tanque son ' || v_cap
               || ' L: parece que se marcaron LITROS en el campo de CENTÍMETROS';
    else
      v_clase  := 'sobre_el_tope';
      v_motivo := 'regla ' || v_alt || ' cm por encima del recorrido configurado ' || v_tope
               || ' cm — revisar el RECORRIDO DE LA REGLA en la configuración del tanque';
    end if;
    v_over := true;
  end if;

  insert into public.combustible_mediciones
    (fecha, tanque_id, vehiculo_id, momento, altura_cm, litros_calculados, registrado_por, notas,
     no_confiable, no_confiable_motivo, no_confiable_por, no_confiable_at)
  values (
    (p->>'fecha')::date, p->>'tanque_id', v_veh, p->>'momento',
    v_alt, v_lit, p->>'registrado_por', p->>'notas',
    v_over, v_motivo,
    case when v_over then 'sistema: ' || v_clase else null end,
    case when v_over then now() else null end)
  on conflict (vehiculo_id, fecha, momento) do update set
    tanque_id = case when p ? 'tanque_id' then excluded.tanque_id
                     else public.combustible_mediciones.tanque_id end,
    altura_cm = case when p ? 'altura_cm' then excluded.altura_cm
                     else public.combustible_mediciones.altura_cm end,
    litros_calculados = case when p ? 'altura_cm' then excluded.litros_calculados
                             when p ? 'litros_calculados' then excluded.litros_calculados
                             else public.combustible_mediciones.litros_calculados end,
    registrado_por = case when p ? 'registrado_por' then excluded.registrado_por
                          else public.combustible_mediciones.registrado_por end,
    notas = case when p ? 'notas' then excluded.notas
                 else public.combustible_mediciones.notas end,
    -- La marca se RECALCULA con cada medición nueva: una corrección válida la limpia.
    no_confiable = case when p ? 'altura_cm' then excluded.no_confiable
                        else public.combustible_mediciones.no_confiable end,
    no_confiable_motivo = case when p ? 'altura_cm' then excluded.no_confiable_motivo
                               else public.combustible_mediciones.no_confiable_motivo end,
    no_confiable_por = case when p ? 'altura_cm' then excluded.no_confiable_por
                            else public.combustible_mediciones.no_confiable_por end,
    no_confiable_at = case when p ? 'altura_cm' then excluded.no_confiable_at
                           else public.combustible_mediciones.no_confiable_at end;

  -- ── El aviso: SOLO cuando el tope puede estar corto, y ahora INSISTE ──────
  -- UNA vez POR DÍA mientras el problema siga (antes era una vez al mes, y 46 h de silencio
  -- se leen igual que «ya lo arreglaron»). Se apaga solo: en cuanto la medición entra
  -- confiable, no hay quién lo dispare. Reusa `mant_aprobador_*`, que ya existe por instancia.
  if v_clase = 'sobre_el_tope' then
    select valor into v_tel   from configuracion where clave = 'mant_aprobador_tel';
    select valor into v_trato from configuracion where clave = 'mant_aprobador_trato';
    if coalesce(btrim(v_tel),'') <> '' then
      v_ref := 'mant_tanque_' || lower(regexp_replace(v_veh, '[^a-zA-Z0-9]', '', 'g'))
               || '_' || to_char((now() at time zone 'America/Caracas'), 'YYYYMMDD');
      if not exists (select 1 from cola_mensajes where ref = v_ref) then
        -- Cuántos DÍAS lleva esta unidad sin poder medir. Es el número que convierte un
        -- aviso en un problema: «lleva 2 días» no se archiva igual que «revisalo».
        select count(distinct fecha) into v_dias
          from public.combustible_mediciones
         where vehiculo_id = v_veh and coalesce(no_confiable,false)
           and litros_calculados is null
           and fecha >= (current_date - 30);
        v_msg := case when coalesce(btrim(v_trato),'') = '' then '' else btrim(v_trato) || ', ' end
              || 'la unidad ' || v_veh || ' NO puede medir el combustible: la regla marcó '
              || v_alt || ' cm y en la configuración su recorrido está en ' || v_tope || ' cm.'
              || chr(10) || chr(10)
              || 'Lo que hay que corregir es el RECORRIDO DE LA REGLA en la configuración del '
              || 'tanque, no el tanque: si la regla llega a ' || v_alt
              || ' cm, ese es el número que va.'
              || chr(10) || chr(10)
              || 'Mientras siga así, esa unidad no produce litros y su consumo queda afuera de '
              || 'la auditoría de combustible.'
              || case when coalesce(v_dias,0) > 1
                      then ' Lleva ' || v_dias || ' días así.' else '' end;
        insert into cola_mensajes (tipo, telefono, mensaje, ref)
        values ('mantenimiento', btrim(v_tel), v_msg, v_ref);
      end if;
    end if;
  end if;
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Y PARA NO DEPENDER DE UN WHATSAPP QUE SE LEYÓ O NO: la lista, consultable.
--
-- 🔴 El aviso del FC17 salió, llegó y quedó `enviado` — y la unidad estuvo 46 h muda igual.
--    Un aviso es un empujón; esto es el ESTADO, y se puede mirar cuando uno quiera.
--    Filtra lo que NO es una lectura de regla (los más de 260 cm y lo que coincide con la
--    capacidad en litros), porque si no la lista queda llena de FC14 con 7.129 cm.
-- ═══════════════════════════════════════════════════════════════════════════════
-- ⚠️ `security_invoker`: sin esto una vista corre con los permisos de su DUEÑO y se saltea
--    el RLS de las tablas de abajo. Acá las dos leen con `using (true)`, así que no cambia lo
--    que se ve — se pone igual, porque el día que una de las dos se cierre, la vista tiene que
--    cerrarse con ella y no quedar como una puerta de atrás.
create or replace view public.v_regla_contradice_el_tope with (security_invoker = true) as
select t.vehiculo_id,
       t.altura_max_cm                              as recorrido_configurado_cm,
       t.regla_origen,
       t.capacidad_litros,
       max(m.altura_cm)                             as regla_marco_hasta_cm,
       max(m.altura_cm) - t.altura_max_cm           as de_mas_cm,
       count(*)                                     as lecturas_afuera,
       count(distinct m.fecha)                      as dias_afuera,
       min(m.fecha)                                 as desde,
       max(m.fecha)                                 as hasta
  from public.combustible_tanques_config t
  join public.combustible_mediciones m
    on m.vehiculo_id = t.vehiculo_id
 where coalesce(t.activo, true)
   and t.altura_max_cm is not null
   and m.altura_cm is not null
   and m.altura_cm > t.altura_max_cm + 2
   and m.altura_cm <= 260                                               -- no es una regla
   and not (t.capacidad_litros is not null and t.capacidad_litros > 0
            and abs(m.altura_cm - t.capacidad_litros) <= t.capacidad_litros * 0.05)  -- son litros
 group by t.vehiculo_id, t.altura_max_cm, t.regla_origen, t.capacidad_litros;

comment on view public.v_regla_contradice_el_tope is 'Unidades cuya REGLA ya marcó más de lo que dice su recorrido configurado (altura_max_cm). La regla no puede marcar más de lo que recorre, así que cada fila acá es un recorrido mal cargado. Excluye lo que no es una lectura de regla: más de 260 cm, y lo que coincide con la capacidad en litros (litros tecleados en el campo de centímetros).';

-- ⛔ UNA VISTA NUEVA NACE ABIERTA A `anon`, Y SON CUATRO VERBOS.
--    Lo trajo la comprobación de esta misma migración: recién creada, la vista tenía
--    DELETE, INSERT, SELECT y UPDATE para `anon` **y** para `authenticated`. No se los
--    dio nadie: los regala `pg_default_acl` en cada objeto nuevo del esquema, y un
--    `revoke ... from public` NO los toca, porque están concedidos a esos roles DIRECTO.
--    ⇒ Se revoca por NOMBRE, y después se concede sólo lo que hace falta: leer.
--    [[norma-toda-tabla-nace-abierta-a-anon-por-default-acl]] · [[norma-vista-no-tiene-rls-y-son-cuatro-verbos]]
revoke all on public.v_regla_contradice_el_tope from public;
revoke all on public.v_regla_contradice_el_tope from anon;
revoke all on public.v_regla_contradice_el_tope from authenticated;
grant select on public.v_regla_contradice_el_tope to authenticated;
