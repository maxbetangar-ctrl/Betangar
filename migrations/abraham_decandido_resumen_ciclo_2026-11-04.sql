-- ═══════════════════════════════════════════════════════════════════════════════
-- ABRAHAM DECANDIDO ENTRA AL RESUMEN DEL CICLO — 2026-11-04
--
-- Máximo, 04/11/2026: la corrección del ciclo va «a alejandro y a abraham decandido»,
-- y después «jonaz y francisco, a todos». Luego: «dejalo anotado en el resumen
-- semanal» ⇒ que lo reciba todas las semanas, no solo esta vez.
--
-- Su número se ubicó por el HISTORIAL DE CHATS del aparato (584122374399@c.us,
-- «Abraham Decandido»), no contando dígitos ni por parecido de nombre. No estaba en
-- `empleados` ni en `torre_contactos`. [[tel-para-escribir-pieza]]
--
-- ⛔ VA CON ROL `banco`, NO `socios`. No es un detalle: son dos buzones muy distintos.
--    · `socios` es COMODÍN y recibe TODO — alertas diarias, auditoría de combustible,
--      auditoría interna, el aviso de que el banco no entra. Nadie pidió eso para él.
--    · `banco` existe aparte A PROPÓSITO (bnc-webhook/index.ts:19): es el buzón de
--      Jonaz y Alejandro, los socios del fondo.
--    Ponerlo como `socios` habría sido suscribirlo en silencio a media casa.
--    [[norma-un-destinatario-por-omision-es-una-fuga]]
--
-- ⚠️ LO QUE ESTO ENCIENDE, DICHO ENTERO. Con rol `banco` va a recibir TRES cosas, las
--    mismas que ya reciben Jonaz y Alejandro:
--      1. `resumen-socios`  — el resumen del ciclo, los miércoles 9:00 VE  ← lo pedido
--      2. `bnc-webhook`     — aviso de CADA pago que entra al banco
--      3. `divisas-banco`   — aviso de cada compra de dólares
--    No hay un rol que reciba SOLO el resumen: los tres que lo reciben
--    (socios/admin/banco) traen algo más. Si Máximo quiere únicamente el resumen,
--    hay que crear un rol nuevo y sumarlo a `ROLES` en `resumen-socios`.
--
-- ⛔ REVERSIBLE: el respaldo del valor anterior queda en
--    `configuracion.backup_whatsapp_2026-11-04`. El UNDO está al final.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Respaldo ANTES de tocar ────────────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_whatsapp_2026-11-04', valor
  from public.configuracion where clave = 'whatsapp'
on conflict (clave) do update set valor = excluded.valor, updated_at = now();

-- ── El alta, sin pisar a nadie y sin duplicar si ya estuviera ──────────────────
update public.configuracion c
   set valor = (
         c.valor::jsonb || jsonb_build_array(jsonb_build_object(
           'key',    '',
           'num',    '584122374399',
           'rol',    'banco',
           'desc',   'Socio del fondo - Abraham Decandido (alta 04/11/2026, pedido de Maximo)',
           'activo', true))
       )::text,
       updated_at = now()
 where c.clave = 'whatsapp'
   and not exists (
     select 1 from jsonb_array_elements(c.valor::jsonb) e
      where replace(replace(replace(coalesce(e->>'num',''),' ',''),'-',''),'+','') = '584122374399');

-- ── Comprobación: quién recibe el resumen del ciclo ────────────────────────────
select e->>'num' num, e->>'rol' rol, e->>'desc' quien, (e->>'activo')::boolean activo
  from public.configuracion c, jsonb_array_elements(c.valor::jsonb) e
 where c.clave = 'whatsapp'
   and (e->>'activo')::boolean
   and e->>'rol' in ('socios','admin','banco')
 order by e->>'rol', e->>'num';

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   update public.configuracion set valor = (select valor from public.configuracion
--     where clave = 'backup_whatsapp_2026-11-04') where clave = 'whatsapp';
-- ═══════════════════════════════════════════════════════════════════════════════
