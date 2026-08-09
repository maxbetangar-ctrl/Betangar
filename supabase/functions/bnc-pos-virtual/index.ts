// ══════════════════════════════════════════════════════════════════════════════
//  bnc-pos-virtual — RESCATADO del proyecto en producción el 2026-08-09.
//  Esta función estaba VIVA (v2, verify_jwt=false) y su código no existía
//  en ningún repositorio: si alguien la borraba, no había de dónde volver a sacarla.
//  Se bajó con GET /v1/projects/<ref>/functions/<slug>/body (viene en ESZIP; el fuente va
//  en texto plano adentro) y se extrajo tal cual, SIN retocarlo: lo que está acá es
//  exactamente lo que corre. Si hay que cambiar algo, cambiarlo y volver a desplegar.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
// POS Virtual BNC - Cobro con tarjeta debito/credito
Deno.serve(async (req)=>{
  const body = await req.json();
  const { action, tenant_slug, recibo_id, monto, moneda, tarjeta, alumno_id, iniciado_por } = body;
  const { data: tenant } = await supabase.from('edu_tenants').select('id').eq('slug', tenant_slug || 'geppetto').single();
  const tenantId = tenant?.id;
  // Obtener credenciales BNC
  const { data: configs } = await supabase.from('edu_configuracion').select('clave,valor').eq('tenant_id', tenantId).eq('categoria', 'banco_bnc');
  const cfg = {};
  configs?.forEach((c)=>{
    if (c.valor) cfg[c.clave] = c.valor;
  });
  if (!cfg.bnc_client_id || !cfg.bnc_client_secret) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Credenciales BNC no configuradas',
      estado: 'sin_credenciales'
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  const baseUrl = cfg.bnc_api_url || 'https://api.bnc.com.ve';
  try {
    // 1. Obtener token OAuth
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
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const authHeader = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    if (action === 'cobrar_tarjeta') {
      // POS Virtual - cobro con tarjeta
      const posPayload = {
        merchant_id: cfg.bnc_pos_merchant_id,
        terminal_id: cfg.bnc_pos_terminal_id,
        monto: monto,
        moneda: moneda || 'USD',
        numero_tarjeta: tarjeta?.numero,
        fecha_vencimiento: tarjeta?.vencimiento,
        cvv: tarjeta?.cvv,
        nombre_titular: tarjeta?.nombre,
        referencia_comercio: `GEPPETTO-${recibo_id?.slice(0, 8)}-${Date.now()}`,
        descripcion: `Pago Preescolar Geppetto`
      };
      const posRes = await fetch(`${baseUrl}/v1/pos/transaccion`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(posPayload)
      });
      const posData = await posRes.json();
      // Guardar transaccion
      const { data: txn } = await supabase.from('edu_transacciones_pos').insert({
        tenant_id: tenantId,
        recibo_id,
        alumno_id,
        tipo: 'pos_virtual',
        numero_tarjeta_mask: tarjeta?.numero?.slice(-4) ? `****${tarjeta.numero.slice(-4)}` : null,
        tipo_tarjeta: posData.tipo_tarjeta || tarjeta?.tipo || 'desconocido',
        banco_emisor: posData.banco_emisor,
        monto,
        moneda: moneda || 'USD',
        referencia_bnc: posData.referencia,
        codigo_autorizacion: posData.codigo_autorizacion,
        estado: posData.aprobado ? 'aprobado' : 'rechazado',
        iniciado_por,
        aprobado_at: posData.aprobado ? new Date().toISOString() : null,
        raw_response: posData
      }).select().single();
      // Si fue aprobado, marcar recibo como pagado
      if (posData.aprobado && recibo_id) {
        await supabase.from('edu_recibos').update({
          estado: 'pagado',
          pagado_monto: monto,
          pagado_fecha: new Date().toISOString(),
          pagado_metodo: `POS Virtual - ${txn?.tipo_tarjeta || 'Tarjeta'}`,
          pagado_referencia: posData.referencia || posData.codigo_autorizacion,
          confirmado_por: iniciado_por || 'Sistema BNC',
          confirmado_at: new Date().toISOString()
        }).eq('id', recibo_id);
      }
      return new Response(JSON.stringify({
        ok: posData.aprobado,
        ...posData,
        txn_id: txn?.id
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'iniciar_c2p') {
      // C2P - el preescolar cobra al representante via pago movil
      const c2pPayload = {
        monto,
        moneda: 'VES',
        telefono_receptor: body.telefono_deudor?.replace(/\D/g, ''),
        banco_receptor: body.banco_deudor,
        cedula_receptor: body.cedula_deudor,
        concepto: `Pago Preescolar Geppetto - ${body.concepto || 'Inscripcion'}`,
        referencia: `GEPPETTO-${Date.now()}`
      };
      const c2pRes = await fetch(`${baseUrl}/v1/c2p/cobro`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(c2pPayload)
      });
      const c2pData = await c2pRes.json();
      await supabase.from('edu_cobros_c2p').insert({
        tenant_id: tenantId,
        recibo_id,
        alumno_id,
        representante_nombre: body.representante_nombre,
        telefono_deudor: body.telefono_deudor,
        banco_deudor: body.banco_deudor,
        cedula_deudor: body.cedula_deudor,
        monto,
        moneda: 'VES',
        referencia: c2pData.referencia,
        estado: 'iniciado',
        token_expira: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        iniciado_por,
        raw_response: c2pData
      });
      return new Response(JSON.stringify({
        ok: true,
        ...c2pData,
        mensaje: 'El representante recibirÃ¡ una notificaciÃ³n en su BNCNET para autorizar el pago'
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'verificar_pago_movil') {
      // Verificar un pago movil especÃ­fico
      const { referencia, monto: montoVerif, telefono } = body;
      const verRes = await fetch(`${baseUrl}/v1/pagomovil/verificar?referencia=${referencia}&monto=${montoVerif}&telefono=${telefono}`, {
        headers: authHeader
      });
      const verData = await verRes.json();
      return new Response(JSON.stringify({
        ok: true,
        ...verData
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'listar_bancos') {
      const bancosRes = await fetch(`${baseUrl}/v1/bancos`, {
        headers: authHeader
      });
      const bancosData = await bancosRes.json();
      return new Response(JSON.stringify({
        ok: true,
        bancos: bancosData
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
      error: String(e)
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});