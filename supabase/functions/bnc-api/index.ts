// ══════════════════════════════════════════════════════════════════════════════
//  bnc-api — RESCATADO del proyecto en producción el 2026-08-09.
//  Esta función estaba VIVA (v2, verify_jwt=false) y su código no existía
//  en ningún repositorio: si alguien la borraba, no había de dónde volver a sacarla.
//  Se bajó con GET /v1/projects/<ref>/functions/<slug>/body (viene en ESZIP; el fuente va
//  en texto plano adentro) y se extrajo tal cual, SIN retocarlo: lo que está acá es
//  exactamente lo que corre. Si hay que cambiar algo, cambiarlo y volver a desplegar.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
// Consulta saldo e historial de cuentas BNC
Deno.serve(async (req)=>{
  const { action, tenant_slug } = await req.json();
  // Obtener credenciales BNC del tenant
  const { data: tenant } = await supabase.from('edu_tenants').select('id').eq('slug', tenant_slug || 'geppetto').single();
  const tenantId = tenant?.id;
  const { data: configs } = await supabase.from('edu_configuracion').select('clave,valor').eq('tenant_id', tenantId).eq('categoria', 'banco_bnc');
  const cfg = {};
  configs?.forEach((c)=>{
    if (c.valor) cfg[c.clave] = c.valor;
  });
  if (!cfg.bnc_client_id || !cfg.bnc_client_secret) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Credenciales BNC no configuradas. Ve a Configuracion > Credenciales BNC en el SuperAdmin.',
      estado: 'sin_credenciales'
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  const baseUrl = cfg.bnc_api_url || 'https://api.bnc.com.ve';
  const ambiente = cfg.bnc_ambiente || 'sandbox';
  try {
    // Paso 1: Obtener token OAuth del BNC
    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.bnc_client_id,
        client_secret: cfg.bnc_client_secret
      })
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Error auth BNC: ${err}`);
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    // Guardar token
    await supabase.from('edu_bnc_tokens').upsert({
      tenant_id: tenantId,
      access_token: accessToken,
      token_type: tokenData.token_type,
      expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
    }, {
      onConflict: 'tenant_id'
    });
    const bncHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    if (action === 'saldo') {
      // Consulta de saldo actual
      const saldoRes = await fetch(`${baseUrl}/v1/cuentas/${cfg.bnc_cuenta_numero}/saldo`, {
        headers: bncHeaders
      });
      const saldo = await saldoRes.json();
      // Guardar en configuracion para cache
      await supabase.from('edu_configuracion').upsert({
        tenant_id: tenantId,
        categoria: 'banco_bnc',
        clave: 'bnc_saldo_cache',
        valor: JSON.stringify({
          ...saldo,
          hora: new Date().toISOString()
        }),
        descripcion: 'Saldo BNC en cache (actualizado automaticamente)',
        es_secreto: false
      }, {
        onConflict: 'tenant_id,clave'
      });
      return new Response(JSON.stringify({
        ok: true,
        saldo
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'movimientos') {
      // Historial ultimos 3 dias
      const hoy = new Date().toISOString().split('T')[0];
      const hace3dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const movRes = await fetch(`${baseUrl}/v1/cuentas/${cfg.bnc_cuenta_numero}/movimientos?fecha_desde=${hace3dias}&fecha_hasta=${hoy}`, {
        headers: bncHeaders
      });
      const movimientos = await movRes.json();
      return new Response(JSON.stringify({
        ok: true,
        movimientos
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'bancos') {
      // Catalogo de bancos
      const bancosRes = await fetch(`${baseUrl}/v1/bancos`, {
        headers: bncHeaders
      });
      const bancos = await bancosRes.json();
      return new Response(JSON.stringify({
        ok: true,
        bancos
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      ok: false,
      error: 'Accion no reconocida'
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e),
      ambiente
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});