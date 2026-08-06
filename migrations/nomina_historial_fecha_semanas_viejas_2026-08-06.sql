-- BETANGAR — Las 8 semanas más viejas del historial no tenían FECHA, y por eso el aviso de
-- "semanas que faltan" las pedía otra vez. Guardarlas de nuevo habría cobrado doble.
-- CORRIDO EN PRODUCCIÓN el 2026-08-06 (hrkjddehqnzcqwlkklqm), autorizado por Máximo.
--
-- ── EL PROBLEMA ─────────────────────────────────────────────────────────────────────────────
-- `_semanasFaltantesNomina()` compara las semanas que tienen planillas contra las que están en
-- `nomina_historial`, y la comparación es POR `fecha_desde`. Las filas `SEM-01`..`SEM-08`
-- (`fuente='excel'`, cargadas antes de que existiera ese campo) lo tienen en NULL → el aviso las
-- daba por NO guardadas y ofrecía un botón para guardar cada una.
--
-- ⛔ Eso NO era cosmético. Guardar una de esas semanas desde la pantalla:
--    1. avanza una cuota de CADA préstamo y CADA multa activa (el aviso lo dice), y
--    2. no encontraba la fila vieja (id distinto) → creaba una SEGUNDA fila para la misma semana,
--       inflando el gasto acumulado.
--    Eran 8 semanas ofrecidas de más sobre 6 reales.
--
-- ── DE DÓNDE SALEN LAS FECHAS (no se inventaron) ────────────────────────────────────────────
-- `SEM-09` sí tiene fecha: 2026-04-27, y de ahí en adelante la serie avanza de lunes en lunes sin
-- huecos (SEM-10 = 04/05, SEM-11 = 11/05, SEM-12 = 18/05, SEM-13 = 25/05). Contando hacia atrás
-- desde SEM-09, `SEM-08` = 20/04 … `SEM-01` = 02/03. Y cuadra por los dos extremos:
--   · la PRIMERA planilla de la base es del 04/03/2026, cuyo lunes es el 02/03 → SEM-01;
--   · son exactamente 8 semanas entre el 02/03 y el 26/04, ni una más ni una menos.
-- Es una numeración correlativa comprobable, no una atribución de datos de nadie.
--
-- No se toca ningún monto: solo se rellena la fecha que faltaba. Las semanas ya pagadas conservan
-- su total y su tasa ([pnl-cerrado-mes-congelado]).

-- ── RESPALDO ────────────────────────────────────────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_nomina_hist_fechas_2026-08-06',
       (select jsonb_agg(to_jsonb(nh))::text          -- alias `nh`: NO es el nombre de ninguna
          from public.nomina_historial nh             -- columna (ver la lección del respaldo roto)
         where nh.id like 'SEM-0%')
on conflict (clave) do update set valor = excluded.valor;

do $$
declare n int; ok boolean;
begin
  select jsonb_array_length(valor::jsonb), (valor::jsonb -> 0 ? 'semana')
    into n, ok from public.configuracion where clave = 'backup_nomina_hist_fechas_2026-08-06';
  if n < 8 or not ok then
    raise exception 'Respaldo inservible (filas=%, trae columnas=%). No se sigue.', n, ok;
  end if;
end $$;

-- ── RELLENO ─────────────────────────────────────────────────────────────────────────────────
-- Solo filas SIN fecha: si alguna ya la tiene, no se pisa.
update public.nomina_historial h
   set fecha_desde = v.desde,
       fecha_hasta = v.desde + 6,
       periodo     = coalesce(nullif(h.periodo,''),
                              'Del '||to_char(v.desde,'DD')||' al '||to_char(v.desde+6,'DD/MM/YYYY'))
  from (values
        ('SEM-01', date '2026-03-02'), ('SEM-02', date '2026-03-09'),
        ('SEM-03', date '2026-03-16'), ('SEM-04', date '2026-03-23'),
        ('SEM-05', date '2026-03-30'), ('SEM-06', date '2026-04-06'),
        ('SEM-07', date '2026-04-13'), ('SEM-08', date '2026-04-20')
       ) as v(id, desde)
 where h.id = v.id and h.fecha_desde is null;

-- ── COMPROBACIÓN ────────────────────────────────────────────────────────────────────────────
-- Tras esto no debe quedar NINGUNA fila sin fecha, y las semanas realmente faltantes deben ser 6
-- (22/06, 29/06, 06/07, 13/07, 20/07 y 27/07).
do $$
declare sin_fecha int; faltan int;
begin
  select count(*) into sin_fecha from public.nomina_historial where fecha_desde is null;
  select count(*) into faltan from (
    select date_trunc('week', f::date)::date lunes from public.planillas group by 1
  ) s where s.lunes < date_trunc('week', current_date)::date
      and not exists (select 1 from public.nomina_historial h where h.fecha_desde::date = s.lunes);
  raise notice 'filas sin fecha: %  ·  semanas realmente faltantes: %', sin_fecha, faltan;
  if sin_fecha <> 0 then raise exception 'Quedaron % filas sin fecha', sin_fecha; end if;
end $$;

-- ── DESHACER ────────────────────────────────────────────────────────────────────────────────
--   update public.nomina_historial set fecha_desde = null, fecha_hasta = null, periodo = ''
--    where id in ('SEM-01','SEM-02','SEM-03','SEM-04','SEM-05','SEM-06','SEM-07','SEM-08');
