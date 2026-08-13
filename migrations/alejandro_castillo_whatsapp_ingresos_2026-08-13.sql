-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ALEJANDRO CASTILLO — el WhatsApp de los ingresos al banco (2026-08-13)
--
-- Segunda parte de `usuario_alejandro_castillo_visor_2026-08-13.sql`. Acá va SOLO lo que vive en
-- la base; el resto son dos archivos de código:
--   · `supabase/functions/bnc-webhook/index.ts` → WA_DESTINOS: cada pago que entra al banco.
--   · `app.js` (aviso de abono registrado) → junto al número de Jonaz.
--
-- Número: +58 414-525 3105 · canónico (últimos 10 dígitos) `4145253105`.
-- Sin la fila en `wa_destinos_permitidos` el INSERT de `anon` se rechaza y el mensaje muere en
-- silencio [[norma-cola-de-mensajes-es-un-arma]].
-- ════════════════════════════════════════════════════════════════════════════════════════════

create temporary table if not exists _w_log(paso text, detalle text) on commit preserve rows;
truncate _w_log;

-- ── 1) Lista blanca de destinos ──────────────────────────────────────────────────────────────
insert into public.wa_destinos_permitidos (telefono_canon, nota)
values (public.wa_tel_canon('584145253105'), 'Socio - Alejandro Castillo (ingresos al banco)')
on conflict (telefono_canon) do update set nota = excluded.nota;
insert into _w_log values ('1. wa_destinos_permitidos', 'alta 4145253105');

-- ── 2) El WhatsApp en su ficha de usuario ────────────────────────────────────────────────────
update public.btg_usuarios set wa = '+584145253105' where usuario = 'alecastillo';
insert into _w_log values ('2. btg_usuarios.wa', 'puesto en alecastillo');

-- ── 3) Control ───────────────────────────────────────────────────────────────────────────────
insert into _w_log
select '3. control',
       'usuario '||u.usuario||' · rol '||u.rol||' · wa '||coalesce(u.wa,'FALTA')
       ||' · permitido='||public.wa_destino_permitido('584145253105')::text
  from public.btg_usuarios u where u.usuario = 'alecastillo';

select * from _w_log;
