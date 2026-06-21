-- Usuarios de Betangar para login con Supabase Auth (reemplaza el USUARIOS hardcodeado).
-- Cada instancia/empresa tiene su propia tabla en su propia base. Mapea auth_user_id → rol.
-- NO guarda contraseñas (esas viven cifradas en Supabase Auth).
CREATE TABLE IF NOT EXISTS btg_usuarios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  usuario      text UNIQUE,        -- username de login (ej: maxbetangar)
  email        text,               -- email de auth (sintético: usuario@betangar.local)
  rol          text,
  nombre       text,
  wa           text,
  activo       boolean DEFAULT true,
  demo         boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE btg_usuarios ENABLE ROW LEVEL SECURITY;
-- Un usuario AUTENTICADO puede leer la lista (staff interno; no hay contraseñas aquí).
-- El anónimo no lee nada (no hace falta antes de iniciar sesión).
DROP POLICY IF EXISTS btg_usuarios_read ON btg_usuarios;
CREATE POLICY btg_usuarios_read ON btg_usuarios FOR SELECT TO authenticated USING (true);
