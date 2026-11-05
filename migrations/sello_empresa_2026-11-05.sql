-- ═══════════════════════════════════════════════════════════════════════════
-- EL SELLO Y LA FIRMA DE LA EMPRESA, PARA QUE EL COMPROBANTE SALGA FIRMADO
-- 05/11/2026
--
-- ⛔ POR QUÉ NO VA EN EL REPO. Betangar se publica por GitHub Pages: todo
--    archivo del repo es descargable por cualquiera que sepa la URL, sin
--    sesión. El sello es la firma de Máximo con el logo de la empresa: es lo
--    que autentica un documento fiscal en nombre de Betangar. Puesto en el
--    repo, cualquiera se lo baja y firma lo que quiera.
--    Entonces vive acá, detrás de RLS, y sólo lo ve una sesión con rol.
--
-- ⛔ Y NO LO VE CUALQUIER ROL. Lo leen los que administran (superadmin,
--    revisor, admin = Keily). Un `operador` o un `visualizador` NO: la firma
--    de la empresa no se reparte con el acceso a una pantalla.
--
-- ⛔ NADIE LO ESCRIBE DESDE LA APP. No hay política de INSERT/UPDATE/DELETE:
--    con RLS encendida y sin política, la tabla está cerrada para `anon` y
--    para `authenticated`. Se carga con `service_role`, desde la PC, a
--    propósito. Un sello que se puede cambiar desde una pantalla es un sello
--    que se puede suplantar.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists empresa_sello (
  clave       text primary key,
  png_dataurl text not null,
  ancho_px    integer,
  alto_px     integer,
  nota        text,
  actualizado timestamptz not null default now()
);

comment on table empresa_sello is
  'El sello + firma de la empresa, en dataURL PNG con transparencia. Lo lee la app al emitir un comprobante de retención para que salga firmado. No va en el repo: el repo es público (GitHub Pages).';
comment on column empresa_sello.clave is
  'Para qué sirve este sello. ''retencion'' = el que va en los comprobantes de retención (IVA e ISLR).';

alter table empresa_sello enable row level security;

-- ⛔ Ni siquiera el privilegio de tabla: `anon` no tiene nada que hacer acá.
revoke all on empresa_sello from anon;

-- Lo LEEN sólo los roles que administran. Nada más.
drop policy if exists sello_sel on empresa_sello;
create policy sello_sel on empresa_sello
  for select to authenticated
  using (app_rol() = any (array['superadmin','revisor','admin']));

-- (Sin política de escritura: la carga es por `service_role`, a propósito.)

-- ⛔ AÑADIDO el mismo día, al MEDIRLO. `authenticated` traía INSERT, UPDATE y
--    DELETE heredados de los privilegios por omisión del esquema. RLS los
--    frenaba igual (no hay política de escritura), pero entonces el candado
--    era la política y no el privilegio: una sesión podía INTENTAR escribir el
--    sello de la empresa. Ahora no le queda más que leerlo, y a eso lo filtra
--    la política por rol.  [[norma-toda-funcion-nace-abierta-a-public]]
revoke insert, update, delete on empresa_sello from authenticated;
-- Medido después de correrlo: authenticated = SELECT y nada más; anon = sin
-- ningún privilegio (pide y recibe 42501).
