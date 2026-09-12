-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- LA CUADRILLA DEL DÍA — quién anduvo en cada camión, declarado por quien no puede falsearlo
-- 2026-09-11 · Betangar (hrkjddehqnzcqwlkklqm)
--
-- POR QUÉ. Máximo, 11/09/2026: *«me gustaría que los ayudantes coloquen en qué unidad van
-- ese día, tanto los internos como los del IMAU, eso nos ayudaría a no tener que tener
-- controles internos; la planilla debe coincidir y cuando no coincidan debe haber un aviso
-- y dar la opción de cambiarlo»*. Y: *«que permita hasta 3 ayudantes»*.
--
-- 🔴 LO QUE SE MIDIÓ ANTES DE DISEÑAR (01/06 → 11/09/2026):
--   · 35 ayudantes activos = 19 internos + 16 del IMAU.
--   · **0 de los 16 del IMAU aparecen en una sola de las 965 planillas.** 18 de 19 internos sí.
--   · `ay3` existe como columna en `planillas` y está lleno en **0 de 965** filas.
--   · El literal «IMAU» —que es lo que cuenta `imauViajesPlanilla()` en app.js— aparece
--     **0 veces**. El contador oficial del IMAU da cero siempre.
--   ⇒ Hoy la unidad del ayudante del IMAU, que es **lo que decide cuánto cobra** (viajes de
--     ESA unidad × $2,50), la teclea RRHH a mano en un modal y se guarda como un JSON dentro
--     de `configuracion` (clave `imau_asis_sem_<lunes>`). Ese es el control interno a borrar.
--   · Y el ayudante ROTA: 3 personas anduvieron en 8 camiones distintos; solo 2 de 22 se
--     quedaron en uno. «Unidad habitual» no alcanza.
--
-- ⛔ LA DECISIÓN DE DISEÑO QUE IMPORTA: esta tabla NO escribe asistencia.
--    Se evaluó guardar la unidad directo en `asistencia_dia` (la columna ya existe) creando
--    la fila si la persona no había fichado. **Se descartó**: eso fabricaría una asistencia
--    —sin selfie y sin GPS— para alguien que capaz no vino, a partir de la palabra de un
--    tercero, y la asistencia decide plata. Un chofer no puede crearle el día a nadie.
--    [[norma-una-alerta-no-puede-nombrar-a-quien-no-estaba]]
--    ⇒ Cada uno declara lo que NO puede falsear:
--        · el CHOFER escaneó el QR del camión → declara la UNIDAD y la cuadrilla (acá).
--        · el AYUDANTE fichó con selfie + GPS + sus 4 dígitos → declara su PRESENCIA
--          (`asistencia_dia`, y ahora también su unidad, por su propio camino).
--      Que el chofer diga «iba conmigo» y esa persona NO tenga fichaje **no es un error a
--      tapar: es el aviso**. Por eso son dos tablas y no una.
--
-- ⚠️ LA CLAVE PRIMARIA NO LLEVA SOLO (fecha, empleado_id) A PROPÓSITO. Betangar hace viajes
--    NOCTURNOS y una persona puede andar en dos unidades el mismo día; un único por día lo
--    haría imposible de registrar. [[norma-candado-unico-codifica-un-supuesto]]
--
-- REVERSA: `drop function cuadrilla_declarar(text,text,text,text[]); drop function
-- cuadrilla_del_dia(text); drop table cuadrilla_dia;` — no toca ninguna tabla existente.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.cuadrilla_dia (
  fecha          date        not null,
  cam            text        not null,
  empleado_id    text        not null,
  nombre         text        not null,   -- congelado al declarar: si después lo renombran, el día no cambia
  cargo          text,
  rol            text        not null check (rol in ('chofer','ayudante')),
  declarado_por  text        not null,   -- 'chofer:E013' | 'oficina:<uid>'
  creado         timestamptz not null default now(),
  primary key (fecha, cam, empleado_id)
);

comment on table public.cuadrilla_dia is
  'Quién anduvo en cada unidad cada día, declarado por el chofer desde el QR. NO es asistencia: '
  'la asistencia vive en asistencia_dia y la crea la persona con su selfie. El cruce de las dos '
  '(y de la planilla) es el control que reemplaza al papel.';

create index if not exists cuadrilla_dia_emp_idx on public.cuadrilla_dia (empleado_id, fecha);

alter table public.cuadrilla_dia enable row level security;

-- La OFICINA lee todo y corrige (es la «opción de cambiarlo» que pidió Máximo). Mismos roles
-- que ya gobiernan `planillas`, para no inventar un segundo modelo de permisos.
drop policy if exists cuad_sel on public.cuadrilla_dia;
create policy cuad_sel on public.cuadrilla_dia for select to authenticated using (true);

drop policy if exists cuad_ins on public.cuadrilla_dia;
create policy cuad_ins on public.cuadrilla_dia for insert to authenticated
  with check (app_rol() = any (array['superadmin','revisor','operador','rrhh','directivo',
                                     'demo_admin','demo_operador','demo_rrhh'])
              and not app_solo_lectura());

drop policy if exists cuad_upd on public.cuadrilla_dia;
create policy cuad_upd on public.cuadrilla_dia for update to authenticated
  using (app_rol() = any (array['superadmin','revisor','operador','rrhh','directivo',
                                'demo_admin','demo_operador','demo_rrhh'])
         and not app_solo_lectura())
  with check (app_rol() = any (array['superadmin','revisor','operador','rrhh','directivo',
                                     'demo_admin','demo_operador','demo_rrhh'])
              and not app_solo_lectura());

drop policy if exists cuad_del on public.cuadrilla_dia;
create policy cuad_del on public.cuadrilla_dia for delete to authenticated
  using (app_puede_borrar() and not app_solo_lectura());

-- ⛔ NINGUNA POLICY PARA `anon`. La app del chofer es pública: escribe y lee SOLO por estas
--    dos funciones, que validan los 4 dígitos del chofer. Sin esto, cualquiera con la llave
--    que está en el HTML podría inventar cuadrillas. [[norma-nunca-abrir-sesion-en-cliente-de-servicio]]

-- ── EL CHOFER DECLARA: él mismo + hasta 3 ayudantes ────────────────────────────────────────
create or replace function public.cuadrilla_declarar(
  p_cam text, p_id text, p_clave text, p_ayudantes text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  v_nombre text; v_cargo text; v_ced4 text;
  v_ids text[]; v_n int := 0; v_desc text[] := '{}';
  r record;
begin
  -- 1) ¿Quién dice ser? Mismo criterio que `fichar_asistencia`: activo + últimos 4 de la cédula.
  select e.nombre, e.cargo, right(regexp_replace(coalesce(e.cedula,''),'[^0-9]','','g'),4)
    into v_nombre, v_cargo, v_ced4
  from public.empleados e where e.id = p_id and coalesce(e.activo,true) = true;
  if v_nombre is null then
    return jsonb_build_object('ok',false,'msg','No se encontró a esa persona activa');
  end if;
  if v_ced4 is null or v_ced4 <> right(regexp_replace(coalesce(p_clave,''),'[^0-9]','','g'),4) then
    return jsonb_build_object('ok',false,'msg','Clave (4 dígitos) incorrecta');
  end if;

  -- 2) La unidad tiene que existir y estar activa. El QR está pegado en el camión, pero el
  --    código se puede teclear: que exista no lo prueba, y aun así una unidad inventada no entra.
  if not exists (select 1 from public.unidad_config u where u.cam = p_cam and coalesce(u.activo,true) = true) then
    return jsonb_build_object('ok',false,'msg','Esa unidad no existe o está inactiva');
  end if;

  -- 3) Los ayudantes: hasta 3, sin repetidos, sin el propio chofer, y todos activos.
  --    ⚠️ El que no exista o esté inactivo NO tumba la declaración entera: se guarda el resto
  --    y se DEVUELVE a quién se dejó afuera. Trancar a un chofer a las 5 AM porque un nombre
  --    de la lista quedó viejo es peor que el hueco. [[norma-catalogo-no-puede-trancar-el-registro]]
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_ayudantes,'{}')) as x
  where x is not null and btrim(x) <> '' and x <> p_id;
  if coalesce(array_length(v_ids,1),0) > 3 then
    return jsonb_build_object('ok',false,'msg','Máximo 3 ayudantes');
  end if;

  -- 4) Se reescribe lo que ESTE chofer declaró hoy para ESTA unidad: declarar de nuevo corrige.
  --    No se toca lo que haya cargado la oficina (declarado_por 'oficina:...'): esa es la
  --    corrección de quien manda, y una re-declaración del chofer no puede pisarla.
  delete from public.cuadrilla_dia c
   where c.fecha = v_hoy and c.cam = p_cam and c.declarado_por like 'chofer:%';

  insert into public.cuadrilla_dia (fecha, cam, empleado_id, nombre, cargo, rol, declarado_por)
  values (v_hoy, p_cam, p_id, v_nombre, v_cargo, 'chofer', 'chofer:'||p_id)
  on conflict (fecha, cam, empleado_id) do update
    set nombre = excluded.nombre, cargo = excluded.cargo, rol = excluded.rol,
        declarado_por = excluded.declarado_por, creado = now();

  if v_ids is not null then
    for r in select e.id, e.nombre, e.cargo
               from public.empleados e
              where e.id = any(v_ids) and coalesce(e.activo,true) = true
    loop
      insert into public.cuadrilla_dia (fecha, cam, empleado_id, nombre, cargo, rol, declarado_por)
      values (v_hoy, p_cam, r.id, r.nombre, r.cargo, 'ayudante', 'chofer:'||p_id)
      on conflict (fecha, cam, empleado_id) do update
        set nombre = excluded.nombre, cargo = excluded.cargo, rol = excluded.rol,
            declarado_por = excluded.declarado_por, creado = now();
      v_n := v_n + 1;
    end loop;
    select array_agg(x) into v_desc
      from unnest(v_ids) as x
     where not exists (select 1 from public.empleados e
                        where e.id = x and coalesce(e.activo,true) = true);
  end if;

  return jsonb_build_object('ok',true,'chofer',v_nombre,'ayudantes',v_n,
                            'descartados',coalesce(v_desc,'{}'),'fecha',v_hoy);
end $$;

revoke all on function public.cuadrilla_declarar(text,text,text,text[]) from public;
grant execute on function public.cuadrilla_declarar(text,text,text,text[]) to anon, authenticated;

-- ── LO QUE SE DECLARÓ HOY PARA ESTA UNIDAD (para que la app lo vuelva a pintar) ───────────
-- No pide clave: devuelve solo nombre y rol de UNA unidad en UN día. Es lo mismo que se ve
-- pegado en el parabrisas del camión, y sin esto el chofer no puede comprobar lo que cargó.
create or replace function public.cuadrilla_del_dia(p_cam text)
returns table(empleado_id text, nombre text, cargo text, rol text, declarado_por text)
language sql
security definer
set search_path = public, extensions
as $$
  select c.empleado_id, c.nombre, c.cargo, c.rol, c.declarado_por
    from public.cuadrilla_dia c
   where c.cam = p_cam
     and c.fecha = (now() at time zone 'America/Caracas')::date
   order by (c.rol <> 'chofer'), c.nombre;
$$;

revoke all on function public.cuadrilla_del_dia(text) from public;
grant execute on function public.cuadrilla_del_dia(text) to anon, authenticated;
