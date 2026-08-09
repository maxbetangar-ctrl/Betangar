// ══════════════════════════════════════════════════════════════════════════════
//  edu-pin-semanal — RESCATADO del proyecto en producción el 2026-08-09.
//  Esta función estaba VIVA (v2, verify_jwt=false) y su código no existía
//  en ningún repositorio: si alguien la borraba, no había de dónde volver a sacarla.
//  Se bajó con GET /v1/projects/<ref>/functions/<slug>/body (viene en ESZIP; el fuente va
//  en texto plano adentro) y se extrajo tal cual, SIN retocarlo: lo que está acá es
//  exactamente lo que corre. Si hay que cambiar algo, cambiarlo y volver a desplegar.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
// Genera PIN de 4 digitos basado en la semana del aÃ±o
function generarPIN(semana, year) {
  const seed = (semana * 7919 + year * 31337) % 9000 + 1000;
  return seed.toString();
}
function getSemanaAnio() {
  const hoy = new Date();
  const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
  const dias = Math.floor((hoy.getTime() - inicioAnio.getTime()) / 86400000);
  const semana = Math.ceil((dias + inicioAnio.getDay() + 1) / 7);
  // Calcular lunes de esta semana
  const diaSemana = hoy.getDay() || 7;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diaSemana + 1);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return {
    semana,
    year: hoy.getFullYear(),
    lunes: lunes.toISOString().split('T')[0],
    domingo: domingo.toISOString().split('T')[0]
  };
}
Deno.serve(async (req)=>{
  const { semana, year, lunes, domingo } = getSemanaAnio();
  const pin = generarPIN(semana, year);
  // Obtener todos los tenants
  const { data: tenants } = await supabase.from('edu_tenants').select('id, nombre');
  const resultados = [];
  for (const tenant of tenants || []){
    // Verificar si ya existe PIN para esta semana
    const { data: pinExistente } = await supabase.from('edu_pin_semanal').select('*').eq('tenant_id', tenant.id).eq('semana_inicio', lunes).single();
    if (!pinExistente) {
      // Crear nuevo PIN
      const { data: nuevoPIN, error } = await supabase.from('edu_pin_semanal').insert({
        tenant_id: tenant.id,
        pin,
        semana_inicio: lunes,
        semana_fin: domingo,
        semana_numero: semana,
        anio: year,
        activo: true
      }).select().single();
      if (!error) {
        resultados.push({
          tenant: tenant.nombre,
          pin,
          semana,
          lunes,
          domingo,
          accion: 'creado'
        });
      }
    } else {
      resultados.push({
        tenant: tenant.nombre,
        pin: pinExistente.pin,
        semana,
        lunes,
        domingo,
        accion: 'existente'
      });
    }
  }
  return new Response(JSON.stringify({
    ok: true,
    semana,
    year,
    pin,
    resultados
  }), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
});