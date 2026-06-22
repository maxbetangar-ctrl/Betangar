#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SEED DE USUARIOS para una INSTANCIA de Betangar (onboarding de empresa nueva).
//
// El panel "🔐 Usuarios" de la app crea usuarios contra la base CENTRAL (el
// service_role de la API vive ahí). Para una empresa CLONADA (su propio Supabase)
// hay que sembrar los usuarios en SU base — esto lo hace este script, ejecutado
// LOCALMENTE por ti con el service_role del cliente (nunca va al navegador ni al repo).
//
// Crea, por cada usuario: la cuenta en Supabase Auth (email sintético
// usuario@betangar.local) + la fila en btg_usuarios (auth_user_id → rol/nombre).
// Es idempotente: si el usuario ya existe, le actualiza la clave y la fila.
//
// REQUISITOS: Node 18+ (usa fetch nativo). NO instala nada.
//
// USO (PowerShell):
//   $env:BTG_URL="https://XXXX.supabase.co"
//   $env:BTG_SERVICE_ROLE="eyJ...service_role..."   # del proyecto del CLIENTE (Settings > API)
//   node seed-usuarios.mjs usuarios.json
//
// usuarios.json (ejemplo):
//   [
//     {"usuario":"maxadmin","password":"claveLarga123","rol":"superadmin","nombre":"Admin Empresa","wa":"+58..."},
//     {"usuario":"operador1","password":"otraClave123","rol":"operador","nombre":"Operador 1"}
//   ]
//
// ⚠️ NO comitees usuarios.json con claves reales. Bórralo o usa .gitignore.
// Antes de correr el seed, en la base del cliente debe existir la tabla btg_usuarios
// (corre migrations_btg_usuarios.sql).
// ─────────────────────────────────────────────────────────────────────────────

const URL = process.env.BTG_URL;
const SRK = process.env.BTG_SERVICE_ROLE;
const archivo = process.argv[2] || 'usuarios.json';

if (!URL || !SRK) {
  console.error('❌ Falta BTG_URL o BTG_SERVICE_ROLE en el entorno. Ver cabecera del script.');
  process.exit(1);
}

import { readFileSync } from 'node:fs';
let usuarios;
try {
  usuarios = JSON.parse(readFileSync(archivo, 'utf8'));
  if (!Array.isArray(usuarios)) throw new Error('el JSON debe ser una lista');
} catch (e) {
  console.error('❌ No pude leer ' + archivo + ': ' + e.message);
  process.exit(1);
}

const limpiar = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
const headers = { apikey: SRK, Authorization: 'Bearer ' + SRK, 'Content-Type': 'application/json' };

async function buscarUid(email) {
  // listUsers paginado, busca por email exacto
  const r = await fetch(URL + '/auth/v1/admin/users?per_page=1000', { headers });
  const j = await r.json().catch(() => ({}));
  const arr = j.users || j || [];
  const ex = (Array.isArray(arr) ? arr : []).find((u) => (u.email || '').toLowerCase() === email);
  return ex ? ex.id : null;
}

async function sembrar(u) {
  const usuario = limpiar(u.usuario);
  if (!usuario || !u.password || u.password.length < 6) {
    return { usuario: u.usuario, ok: false, msg: 'usuario/clave inválidos (clave mín 6)' };
  }
  const email = usuario + '@betangar.local';
  const meta = { usuario, rol: u.rol || 'visualizador', nombre: u.nombre || usuario, demo: !!u.demo };

  // 1) crear cuenta Auth (o actualizar clave si ya existe)
  let uid = null;
  const cr = await fetch(URL + '/auth/v1/admin/users', {
    method: 'POST', headers,
    body: JSON.stringify({ email, password: u.password, email_confirm: true, user_metadata: meta }),
  });
  const cj = await cr.json().catch(() => ({}));
  if (cj && cj.id) uid = cj.id;
  else {
    uid = await buscarUid(email);
    if (uid) {
      await fetch(URL + '/auth/v1/admin/users/' + uid, {
        method: 'PUT', headers,
        body: JSON.stringify({ password: u.password, user_metadata: meta }),
      });
    } else {
      return { usuario, ok: false, msg: 'no se pudo crear Auth: ' + (cj.msg || cj.error_description || cj.error || JSON.stringify(cj)) };
    }
  }

  // 2) upsert en btg_usuarios (onConflict usuario)
  const fila = { auth_user_id: uid, usuario, email, rol: meta.rol, nombre: meta.nombre, wa: u.wa || null, activo: true, demo: meta.demo };
  const up = await fetch(URL + '/rest/v1/btg_usuarios?on_conflict=usuario', {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(fila),
  });
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    return { usuario, ok: false, msg: 'btg_usuarios falló (' + up.status + '): ' + t.slice(0, 200) };
  }
  return { usuario, ok: true, msg: 'rol ' + meta.rol };
}

console.log('🌱 Sembrando ' + usuarios.length + ' usuario(s) en ' + URL + ' …\n');
let okN = 0;
for (const u of usuarios) {
  const r = await sembrar(u);
  console.log((r.ok ? '✅' : '❌') + ' ' + r.usuario + ' — ' + r.msg);
  if (r.ok) okN++;
}
console.log('\nListo: ' + okN + '/' + usuarios.length + ' sembrados.');
process.exit(okN === usuarios.length ? 0 : 1);
