// ════════════════════════════════════════════════════════════════════════════
// FlotaMax — Edge Function: unidad_provisionar
// Crea (o actualiza la clave de) la cuenta de acceso de UNA unidad, para el login
// por unidad de la app del chofer (chofer.html, cuando BTG_CHOFER_CONFIG.login=true).
//
// Usuario de cada unidad = email sintético  u.<slug-del-cam>@<DOMAIN>  (el chofer teclea
// solo su N° de unidad + la clave). email_confirm:true → entra sin verificar correo.
// El cam queda en app_metadata (no editable por el usuario) para RLS por unidad.
//
// SEGURIDAD: solo la puede llamar un usuario de OFICINA autenticado (se valida el rol
// contra btg_usuarios). Un chofer o un anónimo NO puede crear/cambiar accesos.
//
// Deploy (Máximo, desde el proyecto): supabase functions deploy unidad_provisionar
//   (o pegar este código en el dashboard → Edge Functions → New function).
// DOMAIN debe coincidir con BTG_CHOFER_CONFIG.login_domain en chofer.html.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DOMAIN = 'flotamax.app'; // ← DEBE coincidir con BTG_CHOFER_CONFIG.login_domain
const OFICINA = ['superadmin', 'admin', 'rrhh', 'directivo', 'demo_admin', 'demo_rrhh'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function slug(cam: string) {
  return (cam || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function emailUnidad(cam: string) {
  return 'u.' + slug(cam) + '@' + DOMAIN;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    // 1) Autorización: ¿quién llama? Debe ser oficina.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: 'No autorizado' }, 401);
    const asCaller = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await asCaller.auth.getUser();
    const caller = userRes?.user;
    if (!caller) return json({ error: 'Sesión inválida' }, 401);

    const admin = createClient(URL, SERVICE);
    const { data: perfil } = await admin.from('btg_usuarios').select('rol').eq('auth_user_id', caller.id).maybeSingle();
    const rol = (perfil?.rol || '').toLowerCase();
    if (!OFICINA.includes(rol)) return json({ error: 'Solo oficina puede crear accesos de unidad' }, 403);

    // 2) Datos
    const { cam, clave } = await req.json();
    if (!cam || !clave) return json({ error: 'Falta cam o clave' }, 400);
    if (String(clave).length < 4) return json({ error: 'La clave debe tener al menos 4 caracteres' }, 400);
    const email = emailUnidad(cam);
    const appMeta = { cam: String(cam).toUpperCase(), rol: 'unidad' };

    // 3) ¿ya existe la cuenta? (buscar por email paginando)
    let userId: string | null = null;
    for (let page = 1; page <= 25 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
      if (u) userId = u.id;
      if (data.users.length < 200) break;
    }

    // 4) crear o actualizar
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password: String(clave), app_metadata: appMeta });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, updated: true, email });
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password: String(clave), email_confirm: true, app_metadata: appMeta });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, created: true, email });
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
