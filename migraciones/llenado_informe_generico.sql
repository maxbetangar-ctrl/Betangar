-- ══════════════════════════════════════════════════════════════════════════════
-- INFORME DE LLENADO DE LA APP POR EMPLEADO — versión para TODAS las empresas
--
-- Máximo, 08/11/2026: «ese reporte deberia estar en la app y que sea facil de
-- imprimir por parametros de fechas en todos los repos y apps».
--
-- ⛔ ESTE ARCHIVO ES IDÉNTICO EN LAS 6 BASES. Lo que cambia de una empresa a otra
--    NO se escribe acá: se declara en datos (`configuracion` y
--    `llenado_funcion_cargo`). Si hubiera que tocar el SQL para un cliente, está
--    mal pensado. [[norma-arreglo-en-una-es-arreglo-en-todas-misma-sesion]]
--
-- ⛔ POR QUÉ NO SE PUDO COPIAR LA VERSIÓN DE BETANGAR. Medido el 08/11 en las 7
--    bases, dos cosas lo impedían:
--
--    1. LOS CARGOS NO SE PARECEN. Betangar dice `Chofer`; FLOTILLA dice
--       `CONDUCTOR`; TONY GAS tiene 32 cargos distintos (`Conductor Auto
--       Tanque`, `Mecánico` con tilde, `Ayudante de Baranda`, `P.C.P`…). La
--       versión vieja comparaba el texto exacto, así que fuera de Betangar
--       habría metido a TODO EL MUNDO en «oficina» y les habría puesto nota por
--       actividad de oficina. Un informe mudo y equivocado.
--       ⇒ Ahora se clasifica por FUNCIÓN (`btg_llenado_funcion`), y lo que el
--         patrón no reconoce **se devuelve en `cargos_sin_clasificar`**: no se
--         esconde en un cajón. [[norma-falta-de-dato-no-es-un-dato]]
--
--    2. EL PISO DE ATRIBUCIÓN ES DISTINTO EN CADA BASE. El día desde el cual el
--       checklist dice QUIÉN lo llenó: Betangar 12/09/2026, FLOTILLA 25/07/2026,
--       TONY GAS 20/10/2026, DEMO nunca falló. Un piso fijo en el código sería
--       falso en cuatro de cinco. ⇒ Sale de `configuracion`, clave
--       `llenado_piso_atribucion`. Sin fila, no hay piso.
--
-- ⚠️ `empleados.asiste_siempre` SOLO existe en Betangar: acá no se usa.
--    `checklist.turno` solo existe en Betangar: tampoco se usa.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. La tabla que deja a cada empresa corregir la clasificación ───────────
create table if not exists public.llenado_funcion_cargo (
  cargo       text primary key,
  funcion     text not null check (funcion in ('conduce','cuadrilla','vigila','taller','supervisa','oficina','no_aplica')),
  nota        text,
  fijado_at   timestamptz not null default now()
);
comment on table public.llenado_funcion_cargo is
  'Dice que FUNCION cumple cada cargo para el informe de llenado, cuando el patron automatico no acierta. Una fila aca MANDA sobre el patron. `no_aplica` saca al cargo del informe (no se le mide nada).';

alter table public.llenado_funcion_cargo enable row level security;
drop policy if exists llenado_funcion_cargo_lee on public.llenado_funcion_cargo;
create policy llenado_funcion_cargo_lee on public.llenado_funcion_cargo
  for select to authenticated using (true);

-- ── 2. El clasificador ──────────────────────────────────────────────────────
-- Primero la tabla (lo que la empresa declaró), después el patrón.
create or replace function public.btg_llenado_funcion(p_cargo text)
returns text language sql stable
set search_path to 'public', 'pg_temp' as $$
  with n as (
    select translate(upper(btrim(coalesce(p_cargo,''))),
      'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ', 'AAAAEEEEIIIIOOOOUUUUN') c
  )
  select coalesce(
    (select f.funcion from llenado_funcion_cargo f
      where translate(upper(btrim(f.cargo)),'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ','AAAAEEEEIIIIOOOOUUUUN')
            = (select c from n)),
    case
      when (select c from n) = '' then null
      when (select c from n) ~ '(^|[^A-Z])(CHOFER|CONDUCTOR|CONDUCTORA)([^A-Z]|$)' then 'conduce'
      when (select c from n) ~ '(^|[^A-Z])AYUDANTE([^A-Z]|$)'                      then 'cuadrilla'
      when (select c from n) ~ '(^|[^A-Z])VIGILANTE([^A-Z]|$)'                     then 'vigila'
      when (select c from n) ~ '(^|[^A-Z])(MECANICO|MECANICA|MANTENIMIENTO)([^A-Z]|$)' then 'taller'
      when (select c from n) ~ '(^|[^A-Z])(SUPERVISOR|SUPERVISORA|JEFE|COORD)'     then 'supervisa'
      else 'oficina'
    end)
$$;
comment on function public.btg_llenado_funcion(text) is
  'Que funcion cumple un cargo para el informe de llenado: conduce, cuadrilla, vigila, taller, supervisa, oficina o nulo si el cargo esta vacio. Manda la tabla `llenado_funcion_cargo`; si no hay fila, se deduce del texto del cargo sin tildes.';

-- ── 3. La compuerta ─────────────────────────────────────────────────────────
-- ⛔ LEVANTA, no devuelve vacío: un vacío no distingue «no te dejan» de «no hubo
--    nada», y este informe vacío parecería que nadie llenó nunca.
create or replace function public.btg_ve_llenado_o_falla()
returns boolean language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if coalesce(public.app_rol(),'') in
     ('superadmin','admin','rrhh','directivo','operativo','auditor') then
    return true;
  end if;
  raise exception 'El informe de llenado no esta disponible para este usuario. No es que no haya registros: es que este usuario no tiene permiso para verlos.'
    using errcode = '42501';
end $$;

-- ── 4. El informe ───────────────────────────────────────────────────────────
create or replace function public.btg_informe_llenado(p_desde date, p_hasta date)
returns json language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  MIN_DIAS constant int := 10;   -- con menos no se pone nota
  v_piso date;
  v_d date := least(coalesce(p_desde, current_date - 60), coalesce(p_hasta, current_date));
  v_h date := greatest(coalesce(p_hasta, current_date), coalesce(p_desde, current_date - 60));
  v_chk_d date;
  v_aviso text := null;
  v_out json;
begin
  perform public.btg_ve_llenado_o_falla();
  if v_h > current_date then v_h := current_date; end if;

  -- El piso lo declara CADA EMPRESA, no el código.
  begin
    select nullif(btrim(valor),'')::date into v_piso
      from configuracion where clave = 'llenado_piso_atribucion' limit 1;
  exception when others then v_piso := null;
  end;

  v_chk_d := greatest(v_d, coalesce(v_piso, v_d));
  if v_piso is not null and v_d < v_piso then
    v_aviso := 'Pediste desde el ' || to_char(v_d,'DD/MM/YYYY') ||
      ', pero hasta el ' || to_char(v_piso - 1,'DD/MM/YYYY') ||
      ' el checklist no guardaba de forma confiable QUIEN lo llenaba. Lo que mira el checklist se cuenta desde el ' ||
      to_char(v_piso,'DD/MM/YYYY') || '. El fichaje y la porteria si se cuentan desde la fecha que pediste.';
  end if;

  if v_chk_d > v_h then
    return json_build_object('desde', v_d, 'hasta', v_h, 'vacio', true,
      'aviso', coalesce(v_aviso,'') || ' No queda ningun dia medible en ese periodo.');
  end if;

  with
  opero as (select distinct fecha::date d from checklist
            where fecha between v_d::text and v_h::text),
  emp as (
    select e.id, e.nombre, e.cargo, coalesce(nullif(e.unidad,''),'') unidad,
      public.btg_llenado_funcion(e.cargo) fn,
      case when e.fingreso ~ '^\d{4}-\d{2}-\d{2}$'
            and e.fingreso::date between date '1960-01-01' and current_date
           then e.fingreso::date end ingreso_ok
    from empleados e where e.activo
  ),
  -- ⛔ 'no_aplica' SACA a la persona del informe, no la deja con nota vacia.
  --    La tabla lo promete («saca al cargo del informe») y hasta ahora no lo
  --    cumplia: la cuenta de soporte de la casa seguia figurando entre los
  --    empleados de TONY GAS, y un informe que se le entrega a un cliente no
  --    puede listar a nuestra gente como suya.
  emp_fuera as (select id from emp where fn = 'no_aplica'),
  rastro as (
    select e.id, least(
        (select min(a.fecha) from asistencia_dia a where a.empleado_id = e.id),
        (select min(c.fecha::date) from checklist c
          where c.conductor = e.nombre and c.fecha ~ '^\d{4}-\d{2}-\d{2}$'),
        (select min(p.fecha::date) from porteria p
          where p.vigilante = e.nombre and p.fecha ~ '^\d{4}-\d{2}-\d{2}$'),
        (select min(p.f::date) from planillas p
          where (p.ch = e.nombre or p.ay1 = e.nombre or p.ay2 = e.nombre)
            and p.f ~ '^\d{4}-\d{2}-\d{2}$')
      )::date primera
    from emp e where e.id not in (select id from emp_fuera)
  ),
  inicio as (
    select e.id, greatest(v_d, coalesce(e.ingreso_ok, r.primera, v_d))::date d,
      case when e.ingreso_ok is not null then 'fecha de ingreso'
           else 'primer rastro en el sistema' end base
    from emp e join rastro r on r.id = e.id
  ),
  exig as (select i.id, count(*) n from inicio i join opero o on o.d >= i.d group by 1),
  dia as (
    select c.conductor nom, c.fecha::date f,
      max((coalesce(c.km_salida,0)>0 or coalesce(c.hora_salida,'')<>'')::int) sal,
      max((coalesce(c.km_entrada,0)>0 or coalesce(c.hora_entrada,'')<>'')::int) lle,
      max((coalesce(c.observaciones,'')<>'')::int) obs
    from checklist c
    where c.fecha between v_chk_d::text and v_h::text and coalesce(c.llenado_por,'chofer') = 'chofer'
    group by 1,2
  ),
  chk as (
    select nom, count(*) dias_registro,
      count(*) filter (where sal=1 and lle=1) dias_cerrados,
      count(*) filter (where sal=1 and lle=0) dias_sin_cerrar,
      sum(obs) dias_con_obs
    from dia group by 1
  ),
  hueco as (
    select a.empleado_id id, count(distinct a.fecha) n
    from asistencia_dia a join emp e on e.id = a.empleado_id
    where e.fn = 'conduce' and a.origen = 'fichaje'
      and a.fecha between v_chk_d and v_h
      and not exists (select 1 from dia d where d.nom = e.nombre and d.f = a.fecha)
    group by 1
  ),
  fic as (select a.empleado_id id, count(distinct a.fecha) dias from asistencia_dia a
          where a.origen='fichaje' and a.fecha between v_d and v_h group by 1),
  por as (select p.vigilante nom, count(*) n, count(distinct p.fecha) dias from porteria p
          where p.fecha between v_d::text and v_h::text group by 1),
  via as (select v.chofer nom, count(*) n from viajes_chofer v
          where v.fecha between v_chk_d::text and v_h::text group by 1),
  sur as (select s.chofer nom, count(*) n from surtidas s
          where s.fecha between v_chk_d and v_h group by 1),
  usr as (
    select u.usuario, coalesce(u.empleado_id, (
        select e.id from emp e
        where coalesce(u.nombre,'') <> '' and 0 = (
          select count(*) from unnest(string_to_array(
            translate(upper(coalesce(u.nombre,'')),'ÁÉÍÓÚÜÑ','AEIOUUN'),' ')) w
          where w <> '' and translate(upper(e.nombre),'ÁÉÍÓÚÜÑ','AEIOUUN') not like '%'||w||'%')
        limit 1)) emp_id
    from btg_usuarios u where u.activo
  ),
  act as (
    select us.emp_id id, count(*) n, count(distinct a.created_at::date) dias
    from auditoria a join usr us on us.usuario = a.operador
    where us.emp_id is not null and a.created_at::date between v_d and v_h
    group by 1
  ),
  -- ⛔ LAS FIRMAS SON DE CADA PERSONA, no «hay alguna firma en el sistema».
  --    La primera version preguntaba si existia ALGUNA firma —y encima con el
  --    `or`/`and` sin parentesis, o sea sin filtrar por fecha—, asi que un
  --    mecanico que firmo CERO quedaba «Observado» porque otro habia firmado en
  --    mayo. La columna guarda el NOMBRE: se cuenta el suyo.
  firmas as (
    select e.id, count(*) n
    from emp e join checklist c
      on (c.mecanico = e.nombre or c.supervisor = e.nombre)
    where c.fecha between v_chk_d::text and v_h::text
    group by 1
  ),
  base as (
    select e.id, e.nombre, e.cargo, e.unidad, e.fn,
      i.d inicio, i.base base_inicio,
      coalesce(x.n,0) dias_exigibles,
      coalesce(k.dias_registro,0) dias_registro, coalesce(k.dias_cerrados,0) dias_cerrados,
      coalesce(k.dias_sin_cerrar,0) dias_sin_cerrar, coalesce(k.dias_con_obs,0) dias_con_obs,
      coalesce(f.dias,0) dias_ficho, coalesce(h.n,0) ficho_sin_checklist,
      coalesce(p.n,0) porteria_registros, coalesce(p.dias,0) dias_porteria,
      coalesce(v.n,0) viajes, coalesce(s.n,0) surtidas,
      coalesce(ac.n,0) acciones_oficina, coalesce(ac.dias,0) dias_oficina,
      coalesce(fm.n,0) firmas_propias,
      case when coalesce(k.dias_registro,0)>0
           then round(coalesce(k.dias_cerrados,0)::numeric / k.dias_registro, 4) else 0 end cierre,
      case when coalesce(x.n,0)>0 then round(coalesce(f.dias,0)::numeric / x.n, 4) else 0 end tasa_fichaje,
      case when coalesce(x.n,0)>0 then round(coalesce(p.dias,0)::numeric / x.n, 4) else 0 end tasa_porteria
    from emp e
    join inicio i on i.id = e.id
    left join exig x on x.id = e.id
    left join chk k on k.nom = e.nombre
    left join fic f on f.id = e.id
    left join hueco h on h.id = e.id
    left join por p on p.nom = e.nombre
    left join via v on v.nom = e.nombre
    left join sur s on s.nom = e.nombre
    left join act ac on ac.id = e.id
    left join firmas fm on fm.id = e.id
    -- Acá, DESPUÉS de los joins: los cargos marcados `no_aplica` no entran.
    where e.id not in (select id from emp_fuera)
  ),
  juzgado as (
    select b.*,
      case b.fn
        when 'conduce'   then 'Checklist de salida y de llegada, todos los dias que maneja'
        when 'cuadrilla' then 'Fichar la asistencia con foto, todos los dias que trabaja'
        when 'vigila'    then 'Registrar entradas y salidas en porteria, y fichar'
        when 'taller'    then 'Firmar el checklist del chofer y cerrar las fallas que reporta'
        when 'supervisa' then 'Firmar el checklist del chofer y cerrar las fallas que reporta'
        when 'oficina'   then 'Cargar y revisar en la aplicacion lo de su area'
        else 'Sin cargo declarado en su ficha: no se le puede exigir nada todavia' end que_le_toca,
      case
        when b.fn is null or b.fn = 'no_aplica' then 'Sin evaluar'
        when b.fn in ('conduce','cuadrilla') and b.dias_exigibles < MIN_DIAS then 'Sin evaluar'
        when b.fn = 'conduce' then
          case when b.cierre < 0.90 or b.ficho_sin_checklist >= 5 then 'A corregir'
               when b.cierre < 0.98 or b.ficho_sin_checklist >= 2 then 'Observado'
               else 'Cumple' end
        when b.fn = 'cuadrilla' then
          case when b.tasa_fichaje < 0.50 then 'A corregir'
               when b.tasa_fichaje < 0.70 then 'Observado' else 'Cumple' end
        when b.fn = 'vigila' then
          case when b.tasa_porteria >= 0.70 then 'Cumple' else 'Observado' end
        when b.fn in ('taller','supervisa') then
          case when b.firmas_propias = 0 then 'A corregir'
               when b.dias_exigibles > 0 and b.firmas_propias::numeric / b.dias_exigibles < 0.70
                 then 'Observado' else 'Cumple' end
        else case when b.dias_oficina >= 15 then 'Cumple'
                  when b.dias_oficina > 0 then 'Observado' else 'Sin evaluar' end
      end veredicto,
      case
        when b.fn is null then 'su ficha no tiene cargo'
        when b.fn = 'no_aplica' then 'su cargo esta declarado como fuera del informe'
        when b.fn in ('conduce','cuadrilla') and b.dias_exigibles < MIN_DIAS
          then 'solo ' || b.dias_exigibles || ' dias exigibles: entro hace muy poco'
        -- ⛔ CERO DIAS REGISTRADOS NO ES UN PORCENTAJE. Decia «cierra 0% de los
        --    0 dias que registro», que no es una frase: es una division que
        --    nadie pidio. Aparecio en TONY GAS, donde hay choferes que no
        --    abrieron la app una sola vez; en Betangar nunca se vio.
        when b.fn = 'conduce' and b.dias_registro = 0 then
          'no registro NINGUN checklist en ' || b.dias_exigibles || ' dias que le tocaban'
        when b.fn = 'conduce' then
          case when b.ficho_sin_checklist >= 2 then b.ficho_sin_checklist || ' dias ficho y no lleno nada'
               else 'cierra ' || round(b.cierre*100) || '% de los ' || b.dias_registro || ' dias que registro' end
        when b.fn = 'cuadrilla' then
          'ficho ' || b.dias_ficho || ' de ' || b.dias_exigibles || ' dias (' || round(b.tasa_fichaje*100) || '%)'
        when b.fn = 'vigila' then
          'porteria ' || b.dias_porteria || ' de ' || b.dias_exigibles || ' dias; ficho ' || b.dias_ficho
        when b.fn in ('taller','supervisa') then
          'firmo ' || b.firmas_propias || ' checklists de ' || b.dias_exigibles ||
          ' dias; ficho ' || b.dias_ficho || ' y actuo en la app ' || b.dias_oficina
        else case when b.dias_oficina > 0
               then 'trabajo en la app ' || b.dias_oficina || ' dias de ' || b.dias_exigibles
               else 'no tiene nada asignado en la app, o no la usa' end
      end motivo,
      case
        when b.fn is null then 'Ponerle el cargo en su ficha; sin eso no entra en ninguna medicion.'
        when b.fn = 'no_aplica' then 'Nada.'
        when b.fn in ('conduce','cuadrilla') and b.dias_exigibles < MIN_DIAS
          then 'Volver a medirlo cuando cumpla un mes.'
        when b.fn = 'conduce' and b.dias_registro = 0 then
          'Empezar a llenar el checklist. No hay un solo registro suyo en el periodo.'
        when b.fn = 'conduce' then
          case when b.ficho_sin_checklist >= 5
                 then 'Que no haya un dia de trabajo sin checklist. Son ' || b.ficho_sin_checklist || ' dias sin rastro.'
               when b.cierre < 0.90
                 then 'Cerrar el dia al llegar: le faltan ' || (b.dias_registro - b.dias_cerrados) || ' llegadas de ' || b.dias_registro || '.'
               when b.cierre < 0.98 or b.ficho_sin_checklist >= 2
                 then 'Cerrar el dia al llegar, sin excepcion. Esta cerca, no llega.'
               else 'Nada. Reconocerlo delante de los demas.' end
        when b.fn = 'cuadrilla' then
          case when b.tasa_fichaje < 0.50 then 'Fichar todos los dias. Hoy falta mas de la mitad.'
               when b.tasa_fichaje < 0.70 then 'Fichar todos los dias; esta por debajo de sus companeros.'
               else 'Nada.' end
        when b.fn = 'vigila' then
          case when b.tasa_porteria >= 0.70 then 'Fichar tambien: la porteria prueba que estuvo, el fichaje no.'
               else 'Cubrir todos los turnos en porteria y fichar.' end
        when b.fn in ('taller','supervisa') then
          case when b.firmas_propias = 0 and b.dias_ficho > 0
                 then 'Firmar el checklist del chofer cada dia. Esta presente y no firma ninguno.'
               when b.firmas_propias = 0 then 'Entrar a la app y firmar el checklist del chofer.'
               else 'Firmar TODOS los dias, no algunos, y cerrar las fallas abiertas.' end
        else case when b.dias_oficina >= 15 then 'Nada.'
                  when b.dias_oficina > 0 then 'Usar la app para su area, no por fuera.'
                  else 'Definir que le toca cargar, o quitarle la cuenta.' end
      end se_le_exige
    from base b
  )
  select json_build_object(
    'desde', v_d, 'hasta', v_h, 'desde_checklist', v_chk_d, 'piso', v_piso,
    'aviso', v_aviso, 'vacio', false,
    'emitido', to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'),
    'resumen', (
      select json_build_object(
        'dias_opero', (select count(*) from opero),
        'unidades', (select count(distinct cam) from checklist where fecha between v_chk_d::text and v_h::text),
        'checklists', (select count(*) from checklist where fecha between v_chk_d::text and v_h::text),
        'empleados', (select count(*) from juzgado),
        'cumple', count(*) filter (where veredicto='Cumple'),
        'observado', count(*) filter (where veredicto='Observado'),
        'corregir', count(*) filter (where veredicto='A corregir'),
        'sin_evaluar', count(*) filter (where veredicto='Sin evaluar'),
        'dias_chofer', coalesce(sum(dias_registro) filter (where fn='conduce'),0),
        'dias_cerrados', coalesce(sum(dias_cerrados) filter (where fn='conduce'),0),
        'cierre_pct', case when coalesce(sum(dias_registro) filter (where fn='conduce'),0) > 0
          then round(100.0 * sum(dias_cerrados) filter (where fn='conduce')
                   / sum(dias_registro) filter (where fn='conduce'), 1) else 0 end,
        'firmas_mecanico', (select count(*) from checklist
           where coalesce(mecanico,'')<>'' and fecha between v_chk_d::text and v_h::text),
        'firmas_supervisor', (select count(*) from checklist
           where coalesce(supervisor,'')<>'' and fecha between v_chk_d::text and v_h::text)
      ) from juzgado
    ),
    'personas', (
      select coalesce(json_agg(row_to_json(j) order by
        case j.veredicto when 'A corregir' then 0 when 'Observado' then 1
                         when 'Cumple' then 2 else 3 end, j.nombre), '[]'::json)
      from juzgado j
    ),
    -- ⛔ LO QUE EL PATRON NO SUPO CLASIFICAR SE DEVUELVE, no se esconde: si no,
    --    media plantilla cae en «oficina» y el informe se ve perfecto.
    'cargos_sin_clasificar', (
      select coalesce(json_agg(json_build_object('cargo', c, 'personas', n) order by n desc), '[]'::json)
      from (
        select coalesce(nullif(e.cargo,''),'(sin cargo)') c, count(*) n
        from empleados e
        where e.activo
          and not exists (select 1 from llenado_funcion_cargo f
                where translate(upper(btrim(f.cargo)),'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ','AAAAEEEEIIIIOOOOUUUUN')
                    = translate(upper(btrim(coalesce(e.cargo,''))),'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ','AAAAEEEEIIIIOOOOUUUUN'))
          and coalesce(public.btg_llenado_funcion(e.cargo),'(nulo)') in ('oficina','(nulo)')
        group by 1) z
    ),
    -- Checklists del periodo cuyo nombre no esta en el roster: esos dias no se
    -- le cuentan a NADIE, y hay que decirlo.
    'checklists_sin_atribuir', (
      select count(*) from checklist c
      where c.fecha between v_chk_d::text and v_h::text
        and coalesce(c.conductor,'') <> ''
        and c.conductor not in (select nombre from empleados)
    ),
    'fallas', (
      select coalesce(json_agg(x order by x.dias_abierta desc), '[]'::json) from (
        select a.cam unidad,
          case when a.detalle ~* '(litros?|gasoil|combustible)'
                and a.detalle ~* '(sac|suministr|dio|doy|accedi|dar|para la unidad)'
               then 'traspaso de combustible' else 'falla de la unidad' end tipo,
          btrim(regexp_replace(a.detalle, '[\r\n]+', ' - ', 'g')) ultimo_reporte,
          a.critico marcada_critica, a.fecha_reporte,
          (v_h - a.fecha_reporte::date) dias_abierta,
          a.reportado_por quien_reporto,
          (select count(*) from checklist c
            where c.cam = a.cam and coalesce(c.observaciones,'')<>''
              and c.fecha between v_chk_d::text and v_h::text) dias_reportando
        from anomalias a
        where a.fecha_reporte ~ '^\d{4}-\d{2}-\d{2}'
          and a.fecha_reporte <= v_h::text
          and (a.resuelta_at is null or a.resuelta_at::date > v_h)
          and a.estado <> 'descartada'
      ) x
    ),
    'modulos', (
      select json_agg(m order by m.ord) from (
        select 1 ord, 'Checklist de la unidad' modulo, 'Chofer' a_quien_toca,
          (select count(*) from checklist where fecha between v_chk_d::text and v_h::text) registros
        union all select 2, 'Fichaje de asistencia', 'Todo el personal de patio',
          (select count(*) from asistencia_dia where origen='fichaje' and fecha between v_d and v_h)
        union all select 3, 'Porteria (entradas y salidas)', 'Vigilante',
          (select count(*) from porteria where fecha between v_d::text and v_h::text)
        union all select 4, 'Viajes del dia', 'Chofer',
          (select count(*) from viajes_chofer where fecha between v_chk_d::text and v_h::text)
        union all select 5, 'Surtido de combustible', 'Chofer',
          (select count(*) from surtidas where fecha between v_chk_d and v_h)
        union all select 6, 'Mantenimiento', 'Mecanico',
          (select count(*) from auditoria where accion like 'Mantenimiento%'
            and created_at::date between v_d and v_h)
        union all select 7, 'Cierre de fallas reportadas', 'Mecanico / Supervisor',
          (select count(*) from anomalias where resuelta_at::date between v_d and v_h)
        union all select 8, 'Firma del mecanico en el checklist', 'Mecanico',
          (select count(*) from checklist where coalesce(mecanico,'')<>''
            and fecha between v_chk_d::text and v_h::text)
        union all select 9, 'Firma del supervisor en el checklist', 'Supervisor',
          (select count(*) from checklist where coalesce(supervisor,'')<>''
            and fecha between v_chk_d::text and v_h::text)
        union all select 10, 'Entregas al cliente', 'Chofer',
          (select count(*) from entregas where fecha between v_d and v_h)
      ) m
    ),
    'advertencias', json_build_array(
      'Los puntos de inspeccion del checklist NO se guardan uno por uno: la aplicacion solo guarda los que el chofer marca como malos, dentro del texto de observaciones. No se distingue «reviso todo y esta bien» de «apreto Guardar».',
      'La ficha de cada unidad conserva un solo texto de falla, el ultimo: cada observacion nueva reemplaza la anterior. El historial de cada dia si queda en el checklist.',
      'La marca de «critica» se enciende cuando el chofer declara la unidad fuera de servicio ese dia, no por lo que dice el texto.',
      'Un dia libre no es una falta: a cada quien se lo juzga por lo que hizo los dias que trabajo, no por cuantos trabajo.'
    )
  ) into v_out;
  return v_out;
end $$;

comment on function public.btg_informe_llenado(date, date) is
  'El informe de llenado de la aplicacion por empleado activo, para el periodo que se le pida: por cada persona cuanto lleno lo que su FUNCION le exige (conduce, cuadrilla, vigila, taller, supervisa, oficina), el veredicto con su motivo y que exigirle, mas los reportes del chofer abiertos al cierre del periodo y que modulo uso quien. La regla vive aca y en ningun otro lado. Lo que cambia entre empresas se declara en datos: el piso de atribucion en `configuracion` (`llenado_piso_atribucion`) y la funcion de cada cargo en `llenado_funcion_cargo`.';

revoke all on function public.btg_informe_llenado(date, date) from public, anon;
grant execute on function public.btg_informe_llenado(date, date) to authenticated;
revoke all on function public.btg_ve_llenado_o_falla() from public, anon;
grant execute on function public.btg_ve_llenado_o_falla() to authenticated;
revoke all on function public.btg_llenado_funcion(text) from public, anon;
grant execute on function public.btg_llenado_funcion(text) to authenticated;
grant select on public.llenado_funcion_cargo to authenticated;
