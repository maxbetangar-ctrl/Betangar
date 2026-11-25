-- ════════════════════════════════════════════════════════════════════════════════════════════
-- RESUMEN A SOCIOS: CICLO PAGO A PAGO (DE FACTURA A FACTURA) — Betangar · 2026-11-25
--
-- 🔴 QUÉ ESTABA FALLANDO (medido en producción el 25/11/2026):
--    1. El cron salía fijo los miércoles a las 9:00 AM VE cerrando `hasta = HOY`.
--    2. Los pagos de la Alcaldía entran en el banco en la tarde/noche (sync 19:00 VE),
--       DESPUÉS de las 9:00 AM. Al quedar `hasta = miércoles` guardado en corridas,
--       la semana siguiente arrancaba el JUEVES (`f > ultimo_hasta`):
--         · 11/11: fact. 000654 neto (US$ 39.176,08) + 000653 fiel (US$ 4.277,63)
--           = US$ 43.453,71 PERDIDOS (corrida #9 dijo «La Alcaldía no pagó»).
--         · 18/11: fact. 000655 neto (US$ 23.505,65) PERDIDO (corrida #10 solo mostró
--           la fiel del 19/11 y el depósito del 20/11).
--    3. Justo después de correr, `btg_ciclo_alcaldia()` devolvía `desde = HOY+1 > hasta = HOY`
--       (rango invertido en pantalla).
--
-- ✅ EL MECANISMO NUEVO (Opción A — aprobado por Máximo el 25/11/2026):
--    1. NUNCA se cierra un día en curso: todo cierre automático corta como máximo en AYER
--       (`hoy - 1`), cuando el banco ya terminó de sincronizar ese día completo.
--    2. Un ciclo nace con un pago de factura de la Alcaldía (`pata <> 'fiel'`, separado al
--       menos 3 días del inicio del ciclo actual para que fieles o complementos a 1-2 días
--       no partan el ciclo en pedazos) y cierra EXACTAMENTE el día anterior al siguiente
--       pago de factura (`sig_pago - 1`).
--    3. El cron corre TODOS LOS DÍAS a las 9:00 AM VE y pregunta a `btg_ciclo_alcaldia_listo()`:
--         · Si entró un nuevo pago de factura → cierra el ciclo anterior en `sig_pago - 1`
--           y envía el PDF completo.
--         · Si pasaron 8 días completos sin nuevo pago → envía corte de seguimiento hasta ayer
--           (el silencio nunca es una opción).
--         · Si el ciclo sigue abierto → no envía nada.
--    4. `btg_resumen_socios()` agrega `ves_posterior_neto_bs` (flujo neto en VES posterior a
--       `p_hasta`) para que el bloque «Veníamos con / Quedamos con» en bolívares cuadre al
--       centavo incluso cuando el PDF se emite días después del cierre.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Helper: ¿este cobro de la Alcaldía abre un ciclo nuevo? ───────────────────────────────
create or replace function public.btg_es_pago_abre_ciclo(
  p_pata text,
  p_referencia text
) returns boolean
language sql stable as $$
  select
    -- Si el banco o el supervisor lo marcó explícitamente como fiel 10%, NO abre ciclo nuevo.
    lower(coalesce(p_pata, '')) <> 'fiel'
    -- Si en `cobros_factura` todas las filas atadas a esa referencia son `fiel` (caso pago
    -- agrupado de varias fieles como el 30/10), tampoco abre ciclo nuevo.
    and not (
      nullif(btrim(coalesce(p_referencia, '')), '') is not null
      and exists (
        select 1 from cobros_factura c
         where c.referencia = p_referencia and lower(coalesce(c.pata,'')) = 'fiel'
      )
      and not exists (
        select 1 from cobros_factura c
         where c.referencia = p_referencia and lower(coalesce(c.pata,'')) <> 'fiel'
      )
    );
$$;
comment on function public.btg_es_pago_abre_ciclo(text, text) is
  'Verdadero si un cobro de la Alcaldía corresponde a pago de factura principal (no a reintegro de fiel cumplimiento 10%).';

-- ── 2. Qué ciclo está LISTO para enviarse hoy (el cron diario lee esto) ──────────────────────
create or replace function public.btg_ciclo_alcaldia_listo(p_hoy date default null)
returns table (
  listo   boolean,
  desde   date,
  hasta   date,
  dias    int,
  cobros  int,
  motivo  text
)
language sql stable as $$
  with ctx as (
    select coalesce(p_hoy, (now() at time zone 'America/Caracas')::date) as hoy,
           (coalesce(p_hoy, (now() at time zone 'America/Caracas')::date) - 1)::date as ayer
  ),
  ult as (
    select max(c.hasta) as u from btg_resumen_socios_corridas c
  ),
  -- Todos los cobros reales de la Alcaldía hasta hoy
  cobros as (
    select m.fecha::date as f,
           btg_es_pago_abre_ciclo(m.pata, m.referencia) as abre_ciclo
      from bnc_movimientos m, ctx
     where m.categoria = 'cobro_alcaldia'
       and m.tipo = 'credito'
       and not btg_es_espejo(m.id)
       and m.fecha::date <= ctx.hoy
  ),
  -- Inicio del ciclo abierto:
  --   · Si ya hubo corridas: el día siguiente al último cierre (`ult.u + 1`), sin huecos.
  --   · Si es la primera corrida de la historia: el penúltimo o último pago principal.
  base_ini as (
    select case
      when (select u from ult) is not null then ((select u from ult) + 1)::date
      else coalesce(
        (select max(f) from cobros where abre_ciclo and f <= (select ayer from ctx)),
        ((select ayer from ctx) - 6)::date
      )
    end as d_ini
  ),
  -- Siguiente pago de factura que CIERRA el ciclo abierto:
  --   · Tiene que ser pago principal (`abre_ciclo`)
  --   · Al menos 3 días después de `d_ini` (para que un segundo depósito o complemento a 1-2 días
  --     se quede dentro del mismo ciclo y no lo parta en informes diminutos)
  --   · Ya registrado hasta hoy (`f <= hoy`), lo cual garantiza que `f - 1 <= ayer` (día cerrado)
  sig_pago as (
    select min(c.f) as f_sig
      from cobros c, base_ini b, ctx
     where c.abre_ciclo
       and c.f >= b.d_ini + 3
       and c.f <= ctx.hoy
  ),
  calc as (
    select
      b.d_ini,
      ctx.hoy,
      ctx.ayer,
      s.f_sig,
      case
        -- Caso 1: entró un nuevo pago de factura → el ciclo cerró exactamente el día anterior
        when s.f_sig is not null and (s.f_sig - 1) >= b.d_ini and (s.f_sig - 1) <= ctx.ayer then true
        -- Caso 2: pasaron 8 días completos cerrados sin nuevo pago → corte de seguimiento
        when b.d_ini <= ctx.ayer and ((ctx.ayer - b.d_ini) + 1) >= 8 then true
        else false
      end as listo,
      case
        when s.f_sig is not null and (s.f_sig - 1) >= b.d_ini and (s.f_sig - 1) <= ctx.ayer
          then (s.f_sig - 1)::date
        else ctx.ayer
      end as d_fin,
      case
        when s.f_sig is not null and (s.f_sig - 1) >= b.d_ini and (s.f_sig - 1) <= ctx.ayer
          then 'nuevo_pago'
        when b.d_ini <= ctx.ayer and ((ctx.ayer - b.d_ini) + 1) >= 8
          then 'seguimiento_sin_pago'
        else 'ciclo_abierto'
      end as motivo
    from base_ini b, ctx, sig_pago s
  )
  select
    calc.listo,
    calc.d_ini as desde,
    greatest(calc.d_fin, calc.d_ini) as hasta,
    case when calc.d_fin >= calc.d_ini then ((calc.d_fin - calc.d_ini) + 1)::int else 0 end as dias,
    (select count(*)::int from cobros where f between calc.d_ini and calc.d_fin) as cobros,
    calc.motivo
  from calc;
$$;
comment on function public.btg_ciclo_alcaldia_listo(date) is
  'Evalúa si el ciclo abierto de la Alcaldía ya cerró y está listo para enviarse automáticamente. Nunca incluye el día en curso (corta como máximo en ayer). Cierra al entrar un nuevo pago principal (`sig_pago - 1`) o tras 8 días completos sin pago (corte de seguimiento).';

-- ── 3. `btg_ciclo_alcaldia()` para la pantalla (misma firma, nunca devuelve rango invertido) ─
create or replace function public.btg_ciclo_alcaldia(p_hasta date default null)
returns table (desde date, hasta date, dias int, cobros int, arranque text)
language sql stable as $$
  with ctx as (
    select coalesce(p_hasta, (now() at time zone 'America/Caracas')::date) as hoy
  ),
  pend as (
    select * from btg_ciclo_alcaldia_listo((select hoy from ctx))
  ),
  -- Si el ciclo está listo para enviar, mostramos exactamente ese ciclo cerrado.
  -- Si todavía está abierto, mostramos desde `pend.desde` (o el último pago si `desde > hoy`)
  -- hasta `hoy`, garantizando SIEMPRE `desde <= hasta`.
  rango as (
    select
      case
        when pend.listo then pend.desde
        when pend.desde <= ctx.hoy then pend.desde
        else coalesce(
          (select max(m.fecha::date) from bnc_movimientos m
            where m.categoria = 'cobro_alcaldia' and m.tipo = 'credito'
              and not btg_es_espejo(m.id) and btg_es_pago_abre_ciclo(m.pata, m.referencia)
              and m.fecha::date <= ctx.hoy),
          ctx.hoy
        )
      end as d,
      case
        when pend.listo then pend.hasta
        else ctx.hoy
      end as h,
      case
        when pend.listo then pend.motivo
        when exists (
          select 1 from bnc_movimientos m
           where m.categoria = 'cobro_alcaldia' and m.tipo = 'credito'
             and not btg_es_espejo(m.id)
             and m.fecha::date between least(pend.desde, ctx.hoy) and ctx.hoy
        ) then 'pago'
        else 'sin_pago'
      end as arr
    from pend, ctx
  )
  select
    r.d as desde,
    greatest(r.h, r.d) as hasta,
    ((greatest(r.h, r.d) - r.d) + 1)::int as dias,
    (select count(*)::int from bnc_movimientos m
      where m.categoria = 'cobro_alcaldia' and m.tipo = 'credito'
        and not btg_es_espejo(m.id)
        and m.fecha::date between r.d and greatest(r.h, r.d)) as cobros,
    r.arr as arranque
  from rango r;
$$;
comment on function public.btg_ciclo_alcaldia(date) is
  'Ventana que muestra la pantalla Resumen a Socios: si hay un ciclo cerrado pendiente, lo muestra exacto; si no, muestra el ciclo abierto hasta hoy. Nunca devuelve `desde > hasta`.';

revoke execute on function public.btg_es_pago_abre_ciclo(text,text) from public, anon;
grant  execute on function public.btg_es_pago_abre_ciclo(text,text) to authenticated, service_role;
revoke execute on function public.btg_ciclo_alcaldia_listo(date) from public, anon;
grant  execute on function public.btg_ciclo_alcaldia_listo(date) to authenticated, service_role;
revoke execute on function public.btg_ciclo_alcaldia(date) from public, anon;
grant  execute on function public.btg_ciclo_alcaldia(date) to authenticated, service_role;

-- ── 4. Agregar `ves_posterior_neto_bs` a `btg_resumen_socios()` ──────────────────────────────
-- Permite deducir el saldo en bolívares AL CIERRE de `p_hasta` a partir del saldo en vivo del
-- banco, incluso cuando el PDF se emite al día siguiente (o al reemitir un ciclo anterior).
create or replace function public.btg_resumen_socios(p_desde date, p_hasta date)
returns jsonb language sql stable as $fn$
with par_divisas as (
  select c.id credito_id, d.id debito_id, c.monto usd, c.fecha::date f,
         c.tasa_real tasa
    from bnc_movimientos c
    join lateral (
      select dd.id, dd.monto
        from bnc_movimientos dd
       where dd.tipo = 'debito'
         and dd.fecha::date = c.fecha::date
         and abs(dd.monto - c.monto * c.tasa_real) <= 2
       order by abs(dd.monto - c.monto * c.tasa_real)
       limit 1) d on true
   where c.tipo = 'credito'
     and c.categoria = 'divisas_recibidas'
     and c.tasa_real is not null
),
abono_sin_pata as (
  select c.id, c.fecha::date f, c.monto usd,
         trim(regexp_replace(coalesce(c.descripcion,'') || ' ' || coalesce(c.concepto_banco,''),
                             '[[:cntrl:]]+', ' ', 'g')) txt
    from bnc_movimientos c
   where c.tipo = 'credito'
     and c.categoria = 'divisas_recibidas'
     and c.fecha::date between p_desde and p_hasta
     and not exists (select 1 from par_divisas p where p.credito_id = c.id)
),
compradas as (
  select coalesce(sum(p.usd), 0) usd, count(*) n,
         coalesce(sum(d.monto), 0) bs
    from par_divisas p
    left join bnc_movimientos d on d.id = p.debito_id
   where p.f between p_desde and p_hasta
),
-- Flujo neto en bolívares (VES) ocurrido DESPUÉS de `p_hasta`.
-- Restar esto al saldo VES actual del banco devuelve el saldo VES exacto al cierre de `p_hasta`.
ves_post as (
  select coalesce(sum(case when m.tipo = 'credito' then m.monto else -m.monto end), 0) as neto_bs
    from bnc_movimientos m
   where m.fecha::date > p_hasta
     and upper(coalesce(m.moneda, 'VES')) = 'VES'
     and not btg_es_espejo(m.id)
),
mov as (
  select m.id, m.fecha::date f, m.tipo, m.monto, m.categoria, m.es_gasto, m.factura, m.pata,
         m.referencia,
         btg_usd_mov(m.monto, m.moneda, m.fecha::date, m.tasa_real, m.categoria) usd,
         btg_tasa_mov(m.fecha::date, m.tasa_real, m.categoria) tasa,
         trim(regexp_replace(coalesce(m.descripcion,'') || ' ' || coalesce(m.concepto_banco,''),
                             '[[:cntrl:]]+', ' ', 'g')) txt
    from bnc_movimientos m
   where m.fecha::date between p_desde and p_hasta
     and not btg_es_espejo(m.id)
     and m.categoria is distinct from 'traspaso_interno'
     and m.id not in (select credito_id from par_divisas
                      union all select debito_id from par_divisas)
     and m.id not in (select id from abono_sin_pata)),

alc as (select * from mov where tipo='credito' and categoria='cobro_alcaldia'),
otros_in as (select * from mov where tipo='credito' and categoria <> 'cobro_alcaldia'),

gasto as (select * from mov where tipo='debito' and es_gasto),
nogasto as (select * from mov where tipo='debito' and not es_gasto),

camiones as (
  select n.f, n.monto bs, n.tasa, a.monto usd_abono
    from nogasto n join deuda_abonos a on a.mov_id = n.id),
divisas_sueltas as (
  select n.* from nogasto n
   where n.categoria='compra_divisas'
     and not exists (select 1 from deuda_abonos a where a.mov_id = n.id)),

pagables as (select * from gasto where categoria not in ('nomina','comision_banco','impuestos')),
prov as (
  select coalesce(btg_proveedor_de(txt), '(sin identificar)') nombre,
         btg_proveedor_de(txt) is not null ident,
         count(*) n, sum(monto) bs, sum(usd) usd,
         max(left(txt, 60)) muestra
    from pagables group by 1,2),

fiel_falta as (
  select m.factura, min(m.fecha::date) desde_f, sum(m.monto) neto_bs,
         (p_hasta - min(m.fecha::date)) dias,
         sum(m.monto) / 0.909 * 0.10 fiel_estimada_bs,
         (p_hasta - min(m.fecha::date)) <= 8 en_plazo
    from bnc_movimientos m
   where m.categoria='cobro_alcaldia' and m.pata='neto' and not btg_es_espejo(m.id)
     and m.fecha::date <= p_hasta and m.fecha::date >= p_hasta - 120
     and not exists (select 1 from bnc_movimientos g
                      where g.factura = m.factura and g.pata='fiel' and not btg_es_espejo(g.id))
     and not exists (select 1 from cobros_factura c
                      where c.fact = m.factura and c.pata = 'fiel')
   group by m.factura),
sin_tasa as (select count(*) n from mov where usd is null),
sin_clas as (select count(*) n, sum(monto) bs, sum(usd) usd from gasto where categoria='sin_clasificar')

select jsonb_build_object(
 'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', (p_hasta - p_desde) + 1),
 'ves_posterior_neto_bs', round((select neto_bs from ves_post), 2),
 'entro', jsonb_build_object(
    'alcaldia', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', a.f, 'factura', coalesce(a.factura,'(sin número)'), 'pata', coalesce(a.pata,'?'),
          'detalle', (select jsonb_build_object('pata', min(c.pata), 'n', count(*),
                             'desde', min(c.fact), 'hasta', max(c.fact))
                        from cobros_factura c
                       where a.factura is null
                         and nullif(btrim(coalesce(a.referencia,'')),'') is not null
                         and c.referencia = a.referencia
                      having count(*) > 0),
          'bs', round(a.monto,2), 'usd', round(a.usd,2)) order by a.f) from alc a), '[]'::jsonb),
    'alcaldia_bs',  coalesce((select round(sum(monto),2) from alc), 0),
    'alcaldia_usd', coalesce((select round(sum(usd),2)   from alc), 0),
    'otros', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'categoria', categoria, 'bs', round(monto,2), 'usd', round(usd,2),
          'texto', left(txt,60)) order by f) from otros_in), '[]'::jsonb),
    'otros_bs',  coalesce((select round(sum(monto),2) from otros_in), 0),
    'otros_usd', coalesce((select round(sum(usd),2)   from otros_in), 0),
    'total_usd', coalesce((select round(sum(usd),2) from mov where tipo='credito'), 0)),
 'salio_gasto', jsonb_build_object(
    'por_categoria', coalesce((select jsonb_agg(x order by (x->>'usd')::numeric desc) from (
        select jsonb_build_object('categoria', categoria, 'n', count(*),
               'bs', round(sum(monto),2), 'usd', round(sum(usd),2)) x
          from gasto group by categoria) s), '[]'::jsonb),
    'total_bs',  coalesce((select round(sum(monto),2) from gasto), 0),
    'total_usd', coalesce((select round(sum(usd),2)   from gasto), 0)),
 'salio_no_gasto', jsonb_build_object(
    'camiones', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'bs', round(bs,2), 'tasa', round(tasa,4), 'usd', round(usd_abono,2)) order by f)
        from camiones), '[]'::jsonb),
    'camiones_usd', coalesce((select round(sum(usd_abono),2) from camiones), 0),
    'camiones_bs',  coalesce((select round(sum(bs),2) from camiones), 0),
    'divisas_sin_destino', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'bs', round(monto,2), 'usd', round(usd,2), 'texto', left(txt,60)) order by f)
        from divisas_sueltas), '[]'::jsonb),
    'total_bs',  coalesce((select round(sum(monto),2) from nogasto), 0),
    'total_usd', coalesce((select round(sum(usd),2)   from nogasto), 0)),
 'proveedores', coalesce((select jsonb_agg(jsonb_build_object(
      'nombre', nombre, 'identificado', ident, 'n', n,
      'bs', round(bs,2), 'usd', round(usd,2), 'muestra', muestra) order by usd desc nulls last)
    from prov), '[]'::jsonb),
 'avisos', jsonb_build_object(
    'fiel_sin_entrar', coalesce((select jsonb_agg(jsonb_build_object(
          'factura', factura, 'desde', desde_f, 'dias', dias, 'en_plazo', en_plazo,
          'neto_bs', round(neto_bs,2), 'fiel_estimada_bs', round(fiel_estimada_bs,2))
          order by desde_f) from fiel_falta), '[]'::jsonb),
    'fiel_atrasadas', (select count(*) from fiel_falta where not en_plazo),
    'fiel_atrasada_bs', coalesce((select round(sum(fiel_estimada_bs),2) from fiel_falta
                                   where not en_plazo), 0),
    'sin_clasificar', (select jsonb_build_object('n', coalesce(n,0),
          'bs', round(coalesce(bs,0),2), 'usd', round(coalesce(usd,0),2)) from sin_clas),
    'movimientos_sin_tasa', (select n from sin_tasa),
    'divisas_sin_pata', coalesce((select jsonb_agg(jsonb_build_object(
          'fecha', f, 'usd', round(usd,2), 'texto', left(txt, 70)) order by f)
       from abono_sin_pata), '[]'::jsonb)),
 'divisas_compradas', (select jsonb_build_object('usd', round(usd,2), 'operaciones', n,
                                                'bs', round(bs,2))
                         from compradas),
 'saldo_usd', round(coalesce((select sum(usd) from mov where tipo='credito'),0)
                  - coalesce((select sum(usd) from mov where tipo='debito'),0), 2));
$fn$;

-- ── 5. Actualizar `btg_resumen_socios_cuando()` para cron diario de pago a pago ──────────────
create or replace function public.btg_resumen_socios_cuando()
returns text language plpgsql stable security definer set search_path = public, cron as $fn$
declare v_sched text; v_dow text; v_hh int; v_min int; v_activo boolean;
begin
  select schedule, active into v_sched, v_activo from cron.job where jobname = 'resumen-socios-semanal';
  if v_sched is null then return 'no está programado'; end if;
  if not v_activo then return 'está programado pero APAGADO'; end if;
  v_min := split_part(v_sched,' ',1)::int;
  v_hh  := (split_part(v_sched,' ',2)::int + 24 - 4) % 24;
  if split_part(v_sched,' ',5) = '*' then
    return format('al cerrar cada ciclo de pago de la Alcaldía (revisión diaria a las %s:%s)',
                  lpad(v_hh::text,2,'0'), lpad(v_min::text,2,'0'));
  end if;
  v_dow := case split_part(v_sched,' ',5)
             when '0' then 'domingos' when '1' then 'lunes'   when '2' then 'martes'
             when '3' then 'miércoles' when '4' then 'jueves' when '5' then 'viernes'
             when '6' then 'sábados'  else 'día ' || split_part(v_sched,' ',5) end;
  return format('%s a las %s:%s', v_dow, lpad(v_hh::text,2,'0'), lpad(v_min::text,2,'0'));
end $fn$;

revoke execute on function public.btg_resumen_socios_cuando() from public, anon;
grant  execute on function public.btg_resumen_socios_cuando() to authenticated, service_role;

-- ── 6. Corregir `hasta` de corrida #10 (25/11 → 24/11) para no cerrar el día en curso ────────
update public.btg_resumen_socios_corridas
   set hasta = '2026-11-24'
 where id = 10 and hasta = '2026-11-25';

-- ── 7. Pasar el cron a revisión DIARIA a las 9:00 AM VE (13:00 UTC) ──────────────────────────
do $mig$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'resumen-socios-semanal';
  if v_cmd is null then
    raise exception 'No existe el trabajo resumen-socios-semanal; no se reprograma a ciegas';
  end if;
  perform cron.unschedule('resumen-socios-semanal');
  perform cron.schedule('resumen-socios-semanal', '0 13 * * *', v_cmd);

  perform cron.unschedule('resumen-socios-acuse')
    where exists (select 1 from cron.job where jobname = 'resumen-socios-acuse');
  perform cron.schedule('resumen-socios-acuse', '45 13 * * *', replace(v_cmd, '/resumen-socios', '/resumen-socios?acuse=1'));
end
$mig$;
