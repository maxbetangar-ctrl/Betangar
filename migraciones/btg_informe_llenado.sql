-- ══════════════════════════════════════════════════════════════════════════════
-- INFORME DE LLENADO DE LA APP POR EMPLEADO — el que se lleva a la reunión.
--
-- Máximo, 07/11/2026: «necesito un informe detallado por empleado activo de
-- llenado de la aplicacion … para ver quien lo usa quien no», y el 08/11:
-- «que yo lo pueda imprimir desde la app cada vez que lo necesite por filtro de
-- fechas que yo defina por parametros».
--
-- ⛔ LA REGLA DE LA NOTA VIVE ACÁ Y EN NINGÚN OTRO LADO. La pantalla sólo dibuja
--    lo que esta función devuelve. Si la nota se calculara también en `app.js`,
--    serían dos listas a mano y se desincronizarían — ya pasó seis veces en esta
--    casa. [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ EL PISO DEL 12/09/2026. Hasta el 11/09 `checklist.conductor` NO salía de
--    quien llenaba, sino de la lista fija camión→chofer de `app.js`: era falso
--    en el 29,1% de los casos. Medido día por día, el 12/09 es el primer día con
--    nombre real (100% calza con `empleados` desde ahí, 0% antes). Por eso lo
--    que mira el checklist se recorta a ese piso y la función lo DICE en
--    `aviso`: pedir un período anterior no devuelve ceros mudos.
--    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
--
-- ⛔ UN DÍA LIBRE NO ES UNA FALTA. La flota opera los 7 días; nadie trabaja los
--    7. Al chofer se lo juzga por lo que hizo LOS DÍAS QUE TRABAJÓ, no por
--    cuántos trabajó. Por eso la nota no mira presencia.
--
-- ⛔ `empleados.fingreso` NO ES CONFIABLE: hay fichas activas con fechas
--    imposibles (una dice 1696, otra una fecha que no llegó). Cuando la fecha no
--    es posible, el inicio sale del PRIMER RASTRO real de la persona, y
--    `base_del_inicio` dice cuál de las dos se usó. Sin esto, un chofer que
--    entró el 28/10 aparecía con 8 de 57 días = el peor de la flota, cuando
--    había cerrado el 100% de lo que le tocaba.
--
-- ⚠️ LO QUE ESTA FUNCIÓN NO PUEDE DECIR, y por eso viaja en `advertencias`:
--    los 45 puntos de inspección NO se guardan (sólo los marcados como malos,
--    dentro de `observaciones`), así que no se distingue «revisó y está bien» de
--    «apretó Guardar». [[norma-falta-de-dato-no-es-un-dato]]
-- ══════════════════════════════════════════════════════════════════════════════

-- ── La compuerta ─────────────────────────────────────────────────────────────
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

comment on function public.btg_ve_llenado_o_falla() is
  'Deja pasar al informe de llenado solo a superadmin, admin, rrhh, directivo, operativo y auditor. Levanta 42501 a cualquier otro, para que «sin permiso» no se vea igual que «sin datos».';

-- ── El informe ───────────────────────────────────────────────────────────────
create or replace function public.btg_informe_llenado(p_desde date, p_hasta date)
returns json language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  PISO constant date := date '2026-09-12';  -- ver el encabezado
  MIN_DIAS constant int := 10;              -- con menos no se pone nota
  v_d date := least(coalesce(p_desde, PISO), coalesce(p_hasta, current_date));
  v_h date := greatest(coalesce(p_hasta, current_date), coalesce(p_desde, PISO));
  v_chk_d date;          -- piso aplicado, solo para lo que mira el checklist
  v_aviso text := null;
  v_out json;
begin
  perform public.btg_ve_llenado_o_falla();

  if v_h > current_date then v_h := current_date; end if;
  v_chk_d := greatest(v_d, PISO);

  if v_d < PISO then
    v_aviso := 'Pediste desde el ' || to_char(v_d,'DD/MM/YYYY') ||
      ', pero hasta el 11/09/2026 el checklist guardaba un nombre sacado de una lista fija camion-chofer, no de quien lo llenaba. Lo que mira el checklist se cuenta desde el ' ||
      to_char(PISO,'DD/MM/YYYY') || '. El fichaje y la porteria si se cuentan desde la fecha que pediste.';
  end if;

  if v_chk_d > v_h then
    return json_build_object(
      'desde', v_d, 'hasta', v_h, 'vacio', true,
      'aviso', coalesce(v_aviso,'') || ' No queda ningun dia medible en ese periodo.');
  end if;

  with
  -- Días en que la flota realmente operó (hubo al menos un checklist).
  -- ⛔ VA SOBRE EL RANGO COMPLETO, sin el piso del 12/09. Que la flota haya
  --    salido es un hecho aunque el checklist tenga escrito el nombre
  --    equivocado: el piso decide A QUIEN se le atribuye, no si hubo jornada.
  --    Con el piso aca, pedir «desde agosto» contaba el fichaje desde agosto
  --    contra un denominador que arrancaba en septiembre, y la tasa de un
  --    ayudante pasaba del 100%.
  opero as (
    select distinct fecha::date d from checklist
    where fecha between v_d::text and v_h::text
  ),
  dias_opero as (select count(*) n from opero),

  emp as (
    select e.id, e.nombre, e.cargo, e.unidad, e.tipo_ay, e.asiste_siempre,
      case when e.fingreso ~ '^\d{4}-\d{2}-\d{2}$'
            and e.fingreso::date between date '1960-01-01' and current_date
           then e.fingreso::date end ingreso_ok
    from empleados e where e.activo
  ),
  -- El primer rastro real, para cuando `fingreso` es imposible.
  -- ⚠️ Los `::date` van con regex antes: `checklist.fecha`, `porteria.fecha` y
  --    `planillas.f` son TEXTO, y una fila mal escrita tumbaria la funcion
  --    entera. Y el least() se castea: mezclar texto y date lo devuelve en
  --    texto, y despues `o.d >= i.d` no compara fechas sino cadenas.
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
    from emp e
  ),
  inicio as (
    select e.id,
      greatest(v_d, coalesce(e.ingreso_ok, r.primera, v_d))::date d,
      case when e.ingreso_ok is not null then 'fecha de ingreso'
           else 'primer rastro en el sistema' end base
    from emp e join rastro r on r.id = e.id
  ),
  exig as (
    select i.id, count(*) n from inicio i join opero o on o.d >= i.d group by 1
  ),

  -- ── CHOFER: el día se abre con la salida y se cierra con la llegada ────────
  dia as (
    select c.conductor nom, c.fecha::date f,
      max((coalesce(c.km_salida,0)>0 or coalesce(c.hora_salida,'')<>'')::int) sal,
      max((coalesce(c.km_entrada,0)>0 or coalesce(c.hora_entrada,'')<>'')::int) lle,
      max((coalesce(c.observaciones,'')<>'')::int) obs
    from checklist c
    where c.fecha between v_chk_d::text and v_h::text and c.llenado_por = 'chofer'
    group by 1,2
  ),
  chk as (
    select nom, count(*) dias_registro,
      count(*) filter (where sal=1 and lle=1) dias_cerrados,
      count(*) filter (where sal=1 and lle=0) dias_sin_cerrar,
      sum(obs) dias_con_obs
    from dia group by 1
  ),
  -- Días que fichó y NO dejó checklist: ése es el día que de verdad falta.
  hueco as (
    select a.empleado_id id, count(distinct a.fecha) n
    from asistencia_dia a join emp e on e.id = a.empleado_id
    where e.cargo = 'Chofer' and a.origen = 'fichaje'
      and a.fecha between v_chk_d and v_h
      and not exists (select 1 from dia d where d.nom = e.nombre and d.f = a.fecha)
    group by 1
  ),
  fic as (
    select a.empleado_id id, count(distinct a.fecha) dias
    from asistencia_dia a
    where a.origen = 'fichaje' and a.fecha between v_d and v_h
    group by 1
  ),
  por as (
    select p.vigilante nom, count(*) n, count(distinct p.fecha) dias
    from porteria p where p.fecha between v_d::text and v_h::text group by 1
  ),
  via as (
    select v.chofer nom, count(*) n from viajes_chofer v
    where v.fecha between v_chk_d::text and v_h::text group by 1
  ),
  sur as (
    select s.chofer nom, count(*) n from surtidas s
    where s.fecha between v_chk_d and v_h group by 1
  ),

  -- ── OFICINA: la cuenta de la app se liga al empleado ──────────────────────
  -- `empleado_id` está vacío en la mayoría de las cuentas, así que si falta se
  -- calza por nombre normalizado, y SOLO si calza con uno solo.
  usr as (
    select u.usuario,
      coalesce(u.empleado_id, (
        select e.id from emp e
        where 0 = (
          select count(*) from unnest(string_to_array(
            translate(upper(coalesce(u.nombre,'')),'ÁÉÍÓÚÜÑ','AEIOUUN'),' ')) w
          where w <> '' and translate(upper(e.nombre),'ÁÉÍÓÚÜÑ','AEIOUUN')
                            not like '%'||w||'%')
          and coalesce(u.nombre,'') <> ''
        limit 1
      )) emp_id
    from btg_usuarios u where u.activo
  ),
  act as (
    select us.emp_id id, count(*) n, count(distinct a.created_at::date) dias
    from auditoria a join usr us on us.usuario = a.operador
    where us.emp_id is not null
      and a.created_at::date between v_d and v_h
    group by 1
  ),

  -- ── La nota ───────────────────────────────────────────────────────────────
  base as (
    select e.id, e.nombre, e.cargo,
      case when e.tipo_ay='imau' then 'IMAU' when e.tipo_ay='interno' then 'interno' else '' end plantilla,
      coalesce(nullif(e.unidad,''),'') unidad,
      i.d inicio, i.base base_inicio,
      coalesce(x.n,0) dias_exigibles,
      coalesce(k.dias_registro,0) dias_registro,
      coalesce(k.dias_cerrados,0) dias_cerrados,
      coalesce(k.dias_sin_cerrar,0) dias_sin_cerrar,
      coalesce(k.dias_con_obs,0) dias_con_obs,
      coalesce(f.dias,0) dias_ficho,
      coalesce(h.n,0) ficho_sin_checklist,
      coalesce(p.n,0) porteria_registros,
      coalesce(p.dias,0) dias_porteria,
      coalesce(v.n,0) viajes,
      coalesce(s.n,0) surtidas,
      coalesce(ac.n,0) acciones_oficina,
      coalesce(ac.dias,0) dias_oficina,
      case when coalesce(k.dias_registro,0) > 0
           then round(coalesce(k.dias_cerrados,0)::numeric / k.dias_registro, 4)
           else 0 end cierre,
      case when coalesce(x.n,0) > 0
           then round(coalesce(f.dias,0)::numeric / x.n, 4) else 0 end tasa_fichaje,
      case when coalesce(x.n,0) > 0
           then round(coalesce(p.dias,0)::numeric / x.n, 4) else 0 end tasa_porteria
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
  ),
  juzgado as (
    select b.*,
      case b.cargo
        when 'Chofer' then 'Checklist de salida y de llegada, todos los dias que maneja'
        when 'Ayudante' then 'Fichar la asistencia con foto, todos los dias que trabaja'
        when 'Vigilante' then 'Registrar entradas y salidas en porteria, y fichar'
        when 'Mecanico' then 'Firmar el checklist del chofer y cerrar las fallas que reporta'
        when 'Supervisor' then 'Firmar el checklist del chofer y cerrar las fallas que reporta'
        else 'Cargar y revisar en la aplicacion lo de su area' end que_le_toca,
      case
        -- Muestra chica: no se pone nota, se dice por qué.
        when b.cargo in ('Chofer','Ayudante') and b.dias_exigibles < MIN_DIAS then 'Sin evaluar'
        when b.cargo = 'Chofer' then
          case when b.cierre < 0.90 or b.ficho_sin_checklist >= 5 then 'A corregir'
               when b.cierre < 0.98 or b.ficho_sin_checklist >= 2 then 'Observado'
               else 'Cumple' end
        when b.cargo = 'Ayudante' then
          case when b.tasa_fichaje < 0.50 then 'A corregir'
               when b.tasa_fichaje < 0.70 then 'Observado'
               else 'Cumple' end
        when b.cargo = 'Vigilante' then
          case when b.tasa_porteria >= 0.70 then 'Cumple' else 'Observado' end
        when b.cargo in ('Mecanico','Supervisor') then 'A corregir'
        else case when b.dias_oficina >= 15 then 'Cumple'
                  when b.dias_oficina > 0 then 'Observado'
                  else 'Sin evaluar' end
      end veredicto,
      -- ⛔ EL MOTIVO ES EL NÚMERO QUE DECIDIÓ LA NOTA, no una frase suelta: sin
      --    él la nota es una opinión y en la reunión no se puede sostener.
      case
        when b.cargo in ('Chofer','Ayudante') and b.dias_exigibles < MIN_DIAS
          then 'solo ' || b.dias_exigibles || ' dias exigibles: entro hace muy poco'
        when b.cargo = 'Chofer' then
          case when b.ficho_sin_checklist >= 2
               then b.ficho_sin_checklist || ' dias ficho y no lleno nada'
               else 'cierra ' || round(b.cierre*100) || '% de los ' || b.dias_registro || ' dias que registro' end
        when b.cargo = 'Ayudante' then
          'ficho ' || b.dias_ficho || ' de ' || b.dias_exigibles || ' dias (' || round(b.tasa_fichaje*100) || '%)'
        when b.cargo = 'Vigilante' then
          'porteria ' || b.dias_porteria || ' de ' || b.dias_exigibles || ' dias; ficho ' || b.dias_ficho
        when b.cargo in ('Mecanico','Supervisor') then
          'firmo 0 checklists; ficho ' || b.dias_ficho || ' de ' || b.dias_exigibles ||
          ' dias y actuo en la app ' || b.dias_oficina
        else case when b.dias_oficina > 0
               then 'trabajo en la app ' || b.dias_oficina || ' dias de ' || b.dias_exigibles
               else 'no tiene nada asignado en la app, o no la usa' end
      end motivo,
      case
        when b.cargo in ('Chofer','Ayudante') and b.dias_exigibles < MIN_DIAS
          then 'Volver a medirlo cuando cumpla un mes.'
        when b.cargo = 'Chofer' then
          case when b.ficho_sin_checklist >= 5
                 then 'Que no haya un dia de trabajo sin checklist. Son ' || b.ficho_sin_checklist || ' dias sin rastro.'
               when b.cierre < 0.90
                 then 'Cerrar el dia al llegar: le faltan ' || (b.dias_registro - b.dias_cerrados) || ' llegadas de ' || b.dias_registro || '.'
               when b.cierre < 0.98 or b.ficho_sin_checklist >= 2
                 then 'Cerrar el dia al llegar, sin excepcion. Esta cerca, no llega.'
               else 'Nada. Reconocerlo delante de los demas.' end
        when b.cargo = 'Ayudante' then
          case when b.tasa_fichaje < 0.50 then 'Fichar todos los dias. Hoy falta mas de la mitad.'
               when b.tasa_fichaje < 0.70 then 'Fichar todos los dias; esta por debajo de sus companeros.'
               else 'Nada.' end
        when b.cargo = 'Vigilante' then
          case when b.tasa_porteria >= 0.70
               then 'Fichar tambien: la porteria prueba que estuvo, el fichaje no.'
               else 'Cubrir todos los turnos en porteria y fichar.' end
        when b.cargo in ('Mecanico','Supervisor') then
          case when b.dias_oficina > 0
               then 'Revisar y firmar el checklist cada dia, y cerrar las fallas abiertas.'
               else 'Entrar a la app. Esta presente todos los dias y no deja un solo rastro.' end
        else case when b.dias_oficina >= 15 then 'Nada.'
                  when b.dias_oficina > 0 then 'Usar la app para su area, no por fuera.'
                  else 'Definir que le toca cargar, o quitarle la cuenta.' end
      end se_le_exige
    from base b
  )
  select json_build_object(
    'desde', v_d, 'hasta', v_h, 'desde_checklist', v_chk_d,
    'aviso', v_aviso, 'vacio', false,
    'emitido', to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI'),
    'resumen', (
      select json_build_object(
        'dias_opero', (select n from dias_opero),
        'unidades', (select count(distinct cam) from checklist where fecha between v_chk_d::text and v_h::text),
        'checklists', (select count(*) from checklist where fecha between v_chk_d::text and v_h::text),
        'empleados', (select count(*) from juzgado),
        'cumple', count(*) filter (where veredicto='Cumple'),
        'observado', count(*) filter (where veredicto='Observado'),
        'corregir', count(*) filter (where veredicto='A corregir'),
        'sin_evaluar', count(*) filter (where veredicto='Sin evaluar'),
        'dias_chofer', coalesce(sum(dias_registro) filter (where cargo='Chofer'),0),
        'dias_cerrados', coalesce(sum(dias_cerrados) filter (where cargo='Chofer'),0),
        'cierre_pct', case when coalesce(sum(dias_registro) filter (where cargo='Chofer'),0) > 0
          then round(100.0 * sum(dias_cerrados) filter (where cargo='Chofer')
                   / sum(dias_registro) filter (where cargo='Chofer'), 1) else 0 end,
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
    -- Abiertas AL CIERRE del período pedido, no «hoy»: si se pide un mes viejo,
    -- tiene que decir lo que estaba abierto ESE dia.
    'fallas', (
      select coalesce(json_agg(x order by x.dias_abierta desc), '[]'::json) from (
        select a.cam unidad,
          case when a.detalle ~* '(litros?|gasoil|combustible)'
                and a.detalle ~* '(sac|suministr|dio|doy|accedi|dar|para la unidad)'
               then 'traspaso de gasoil' else 'falla de la unidad' end tipo,
          -- Los saltos de linea parten la fila al exportar: se aplanan aca.
          btrim(regexp_replace(a.detalle, '[\r\n]+', ' - ', 'g')) ultimo_reporte,
          a.critico marcada_critica,
          a.fecha_reporte,
          (v_h - a.fecha_reporte::date) dias_abierta,
          a.reportado_por quien_reporto,
          (select count(*) from checklist c
            where c.cam = a.cam and coalesce(c.observaciones,'')<>''
              and c.fecha between v_chk_d::text and v_h::text) dias_reportando
        from anomalias a
        -- `fecha_reporte` es TEXTO: se compara como texto (ISO ordena igual) y
        -- el `::date` de arriba solo corre sobre filas bien escritas.
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
        union all select 11, 'Movimientos de inventario', 'Almacen',
          (select count(*) from inventario_mov where fecha between v_d::text and v_h::text)
      ) m
    ),
    'advertencias', json_build_array(
      'Los 45 puntos de inspeccion NO se guardan: la aplicacion solo guarda los que el chofer marca como malos, dentro del texto de observaciones. No se distingue «reviso todo y esta bien» de «apreto Guardar».',
      'La ficha de cada unidad conserva un solo texto de falla, el ultimo: cada observacion nueva reemplaza la anterior. El historial de cada dia si queda en el checklist.',
      'La marca de «critica» se enciende cuando el chofer declara la unidad fuera de servicio ese dia, no por lo que dice el texto.',
      'Un dia libre no es una falta: al chofer se lo juzga por lo que hizo los dias que trabajo, no por cuantos trabajo.'
    )
  ) into v_out;

  return v_out;
end $$;

comment on function public.btg_informe_llenado(date, date) is
  'El informe de llenado de la aplicacion por empleado activo, para el periodo que se le pida: devuelve por cada persona cuanto lleno lo que su cargo le exige, el veredicto (Cumple / Observado / A corregir / Sin evaluar) con su motivo y que exigirle, mas los reportes del chofer que seguian abiertos al cierre del periodo y que modulo uso quien. La regla de la nota vive aca y en ningun otro lado. Lo que mira el checklist nunca baja del 12/09/2026, porque antes el checklist no guardaba quien lo llenaba.';

revoke all on function public.btg_informe_llenado(date, date) from public, anon;
grant execute on function public.btg_informe_llenado(date, date) to authenticated;
revoke all on function public.btg_ve_llenado_o_falla() from public, anon;
grant execute on function public.btg_ve_llenado_o_falla() to authenticated;
