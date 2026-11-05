-- ═══════════════════════════════════════════════════════════════════════════════
-- UNA CUENTA QUE NO PODEMOS LEER NO VALE CERO — 2026-11-04
--
-- 🔴 EL TABLERO DECÍA $0,00 SOBRE US$ 23.900. Máximo mandó la pantalla del portal
--    del BNC: la cuenta en dólares **01910040522340021897** tiene **US$ 23.900,00**
--    — seis compras de divisas desde el 24/08 y **ni un solo débito**, y el saldo
--    acumulado de su propia captura lo confirma:
--
--      24/08  2.500,00 → saldo  2.500,00      30/10 12.000,00 → saldo 16.500,00
--      01/09  2.000,00 → saldo  4.500,00      02/11  4.600,00 → saldo 21.100,00
--      03/11  2.500,00 → saldo 23.600,00      04/11    300,00 → saldo 23.900,00
--
--    Y cuadra EXACTO con los seis `divisas_recibidas` que ya tiene la base.
--
-- ⛔ LO QUE HACE QUE ESTO SEA INSIDIOSO: el banco no omite la cuenta, **devuelve un
--    cero**. Medido llamando a la función el 04/11:
--      "01910040522340021897": {"CurrencyCode":"USD","Balance":0}
--    O sea que mirando la respuesta NO se puede distinguir de un cero legítimo —
--    la cuenta 01910304842100014881, en bolívares, SÍ está en cero de verdad.
--    Un primer arreglo que solo trataba el caso «no vino nada» no habría servido:
--    se comprobó llamando a la función, no suponiendo. [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
-- ⇒ CUÁL CUENTA NO PODEMOS LEER ES UN HECHO DECLARADO, no algo que se adivine por
--   el valor. Máximo, 04/11/2026: «no es que tú no tienes acceso a la cuenta en
--   dólares… osea no te deja verla», y «voy a coordinar con el banco a ver si te
--   deja verla». Se declara acá; el día que el banco la habilite, se borra de esta
--   lista y el saldo aparece solo, sin tocar código.
--
-- 📌 Y queda otra pendiente que NO se puede declarar todavía: Máximo dice que hay
--    una QUINTA cuenta, también en dólares, que la API **ni siquiera lista**. Esa
--    no se arregla acá — no se puede marcar lo que no aparece.
-- ═══════════════════════════════════════════════════════════════════════════════

insert into public.configuracion (clave, valor) values
  ('bnc_cuentas_sin_saldo', '["01910040522340021897"]')
on conflict (clave) do update set valor = excluded.valor, updated_at = now();

comment on table public.configuracion is
  'Configuracion de la casa. `bnc_cuentas_sin_saldo` = cuentas cuyo saldo el BNC NO nos devuelve de verdad (manda cero). Para esas el tablero escribe «sin acceso» en vez de un numero.';

select clave, valor, updated_at from public.configuracion where clave = 'bnc_cuentas_sin_saldo';

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   delete from public.configuracion where clave = 'bnc_cuentas_sin_saldo';
-- ═══════════════════════════════════════════════════════════════════════════════
