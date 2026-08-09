-- ============================================================================
-- Betangar · la clasificación deja de ser un script de una noche y pasa a ser
-- una FUNCIÓN que se puede volver a correr. 2026-08-09.
--
-- POR QUÉ
-- Las reglas del 08/08 se aplicaron como UPDATEs sueltos en una migración. Eso
-- clasificó lo que había en ese momento y nada más: cada movimiento que entre
-- desde hoy queda crudo hasta que alguien vuelva a correr el SQL a mano. Con el
-- traído automático del banco eso es garantía de que la clasificación se atrase
-- en silencio. Ahora es `bnc_clasificar()` y se llama al terminar de traer.
--
-- ⛔ LO QUE NO CAMBIA: nada pisa lo que decidió una persona
-- (`clasificado_por like 'manual:%'`). Esa regla es de la casa.
--
-- 🆕 LO QUE SE AGREGA: EL TRASPASO ENTRE CUENTAS PROPIAS
-- El banco entrega 4 cuentas, no una. Entre ellas se pasan plata, y esa plata
-- NO sale de la empresa: es el mismo dinero cambiando de bolsillo. Contarlo
-- sería inventar un gasto y un ingreso que no existen.
-- Y hay que ponerlo ARRIBA DE TODO, porque el concepto del traspaso suele
-- describir PARA QUÉ se manda la plata, no lo que el traspaso es. Caso real:
--   «TRANSFERENCIA A FAVOR DE: INVERSIONES BETANGAR, C.A PARA LA CUENTA NRO.
--    01910040502140088290 IMPUEST…»
-- quedó clasificado como `impuestos`. El impuesto de verdad se paga DESPUÉS,
-- cuando sale de la cuenta secundaria hacia el SENIAT. Si valen los dos, el
-- mismo impuesto se cuenta dos veces. [[norma-salida-de-banco-no-es-gasto]]
-- ============================================================================

-- ------------------------------------------------- las cuentas que son NUESTRAS
-- En una tabla y no dentro de la función: si mañana se abre otra cuenta, se
-- agrega una fila y no hay que tocar código. [[norma-fuente-unica-datos]]
create table if not exists bnc_cuentas_propias (
  cuenta     text primary key,
  alias      text,
  nota       text,
  created_at timestamptz not null default now()
);
comment on table bnc_cuentas_propias is
  'Cuentas del BNC que son de la empresa. Un movimiento entre dos de estas NO es gasto ni ingreso.';

insert into bnc_cuentas_propias (cuenta, alias, nota) values
  ('01910031682131012653','principal','La del estado de cuenta que llevaba Aurelys en Excel'),
  ('01910040502140088290','secundaria','67 de sus 72 movimientos son traspasos desde la principal'),
  ('01910040522340021897','tercera','Sin movimientos en el período 23/03–08/08'),
  ('01910304842100014881','cuarta','Por acá pasó el «préstamo Castillo»: entró Bs 1.293.600 el 30/05 y volvió el 01/06')
on conflict (cuenta) do nothing;

alter table bnc_cuentas_propias enable row level security;
revoke all on bnc_cuentas_propias from anon, public;
grant select, insert, update, delete on bnc_cuentas_propias to authenticated;
do $$
begin
  drop policy if exists btg_rol_lectura on bnc_cuentas_propias;
  drop policy if exists btg_rol_ins on bnc_cuentas_propias;
  drop policy if exists btg_rol_upd on bnc_cuentas_propias;
  drop policy if exists btg_rol_del on bnc_cuentas_propias;
  create policy btg_rol_lectura on bnc_cuentas_propias for select to authenticated
    using (app_rol() = any (array['superadmin','auditor','admin','operador','rrhh','visualizador','directivo','demo_admin','demo_operador','demo_rrhh']));
  create policy btg_rol_ins on bnc_cuentas_propias for insert to authenticated
    with check (app_rol() = any (array['superadmin','admin']));
  create policy btg_rol_upd on bnc_cuentas_propias for update to authenticated
    using (app_rol() = any (array['superadmin','admin']))
    with check (app_rol() = any (array['superadmin','admin']));
  create policy btg_rol_del on bnc_cuentas_propias for delete to authenticated
    using (app_rol() = any (array['superadmin','admin']) and not app_exige_token());
end $$;

-- ---------------------------------------------------------------- la función
-- Devuelve cuántos movimientos clasificó, para que quien la llame pueda avisar
-- si el número no es el esperado en vez de suponer que salió bien.
create or replace function bnc_clasificar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- (0) TRASPASO ENTRE CUENTAS PROPIAS — va PRIMERO, ver el comentario de arriba.
  -- Se reconoce porque el concepto nombra otra cuenta nuestra. `cuenta` guarda
  -- de cuál de las nuestras salió, así que se exige que la nombrada sea OTRA:
  -- una transferencia que nombre su PROPIA cuenta no es un traspaso.
  update bnc_movimientos m
     set categoria = 'traspaso_interno', es_gasto = false,
         clasificado_por = 'concepto:traspaso_interno', clasificado_at = now()
    from bnc_cuentas_propias c
   where position(c.cuenta in coalesce(m.descripcion,'')) > 0
     and c.cuenta is distinct from m.cuenta
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- (a) ENTIDAD por identificador normalizado (RIF / cédula / cuenta).
  update bnc_movimientos m
     set entidad_id = i.entidad_id
    from bnc_entidad_ident i
   where bnc_norm_ident(m.descripcion) like '%' || i.ident || '%'
     and length(i.ident) > 5
     and m.entidad_id is distinct from i.entidad_id
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- (b) EXCEPCIONES DENTRO DE LA ENTIDAD (la entidad sola no decide).
  update bnc_movimientos m
     set categoria = 'compra_divisas', es_gasto = false,
         clasificado_por = 'concepto:autounion_divisas', clasificado_at = now()
    from bnc_entidades e
   where m.entidad_id = e.id and e.nombre ilike 'AUTO UNION%'
     and m.descripcion ~* 'asignaci|consignaci|cambio de moneda|deuda camion'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = 'alquiler', es_gasto = true,
         clasificado_por = 'concepto:palotal_alquiler', clasificado_at = now()
    from bnc_entidades e
   where m.entidad_id = e.id and e.nombre ilike '%PAZ JIMENEZ%'
     and m.descripcion ~* 'alquiler|arrendamiento|galp[oó]n'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos m
     set categoria = 'reembolso', es_gasto = true,
         clasificado_por = 'concepto:maximo_reembolso', clasificado_at = now()
    from bnc_entidades e
   where m.entidad_id = e.id and e.nombre = 'MÁXIMO BETANCOURT'
     and m.descripcion ~* 'reembolso|compras en exterior|devoluci|prestamo|prÉstamo|equipos importados|zoom'
     and coalesce(m.categoria,'') is distinct from 'traspaso_interno'
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  update bnc_movimientos
     set categoria = 'comision_banco', es_gasto = true,
         clasificado_por = 'concepto:comision', clasificado_at = now()
   where descripcion ~* 'comisi[oó]n bancaria|comision x cred|comisi[oó]n mantenimiento'
     and coalesce(categoria,'') is distinct from 'traspaso_interno'
     and coalesce(clasificado_por,'') not like 'manual:%';

  -- (c) DEFAULT DE LA ENTIDAD.
  update bnc_movimientos m
     set categoria = e.categoria, es_gasto = e.es_gasto,
         clasificado_por = 'entidad', clasificado_at = now()
    from bnc_entidades e
   where m.entidad_id = e.id
     and m.categoria is null
     and coalesce(m.clasificado_por,'') not like 'manual:%';

  -- (d) POR CONCEPTO, para los que no traen identificador. Lo específico arriba.
  update bnc_movimientos
     set categoria = v.cat, es_gasto = v.gasto,
         clasificado_por = 'concepto:'||v.regla, clasificado_at = now()
    from (values
      ('prestamo_empleado', false, 'prestamo',    '(prestamo|préstamo).*(empleado|medicament)|prestamo a empleado'),
      ('pago_socio',        true,  'socio',       'pago a socio|pago socio|fiel cumpl|sociedad betangar|abono 0,5|reparto de dividendo'),
      ('resp_social',       true,  'resp_social', 'resp\.? *social|responsabilidad social|aporte social'),
      ('impuestos',         true,  'impuestos',   'seniat|\yislr\y|\yiva\y|impuesto|retenc|\ydpp\y|pensionad'),
      ('nomina',            true,  'nomina',      'n[oó]mina|\ysem ?\d'),
      ('combustible',       true,  'combustible', 'gasoil|combustible|gasolina'),
      ('seguro',            true,  'seguro',      'seguro m[eé]dico|salud zulia'),
      ('software',          true,  'software',    'galac|sofware|software'),
      ('tramites',          true,  'tramites',    '\yrnc\y|bombero|arancel|permiso|solvencia'),
      ('dotacion',          true,  'dotacion',    'uniforme|chaleco|dotaci'),
      ('mantenimiento',     true,  'mantto',      'servicio a unidad|mantenimiento|filtro|aceite|repuesto|caucho|goma|llanta|lavado'),
      ('implantacion_maxware', true, 'alejandra', 'virginia castillo|apoyo administrativo')
    ) as v(cat, gasto, regla, patron)
   where bnc_movimientos.categoria is null
     and bnc_movimientos.descripcion ~* v.patron
     and coalesce(bnc_movimientos.clasificado_por,'') not like 'manual:%';

  -- (e) RESTO: se marca como tal. Un movimiento sin categoría es invisible;
  -- uno marcado `sin_clasificar` sale en la lista de lo que falta mirar.
  update bnc_movimientos
     set categoria = 'sin_clasificar', es_gasto = true,
         clasificado_por = 'ninguna_regla', clasificado_at = now()
   where categoria is null
     and coalesce(clasificado_por,'') not like 'manual:%';

  select count(*) into n from bnc_movimientos where categoria is not null;
  return n;
end $$;

revoke all on function bnc_clasificar() from anon, public;
grant execute on function bnc_clasificar() to authenticated;

comment on function bnc_clasificar() is
  'Clasifica los movimientos del banco sin pisar lo decidido a mano. Llamarla DESPUÉS de traer del banco. Devuelve cuántos quedaron con categoría.';
