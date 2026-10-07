// ════════════════════════════════════════════════════════════════════════════
// CUBICACIÓN — de las MEDIDAS del tanque a la tabla cm → litros.
//
// Por qué existe: la tabla de un tanque describe A ESE TANQUE. Aplicarle a un carro la
// tabla de otro es inventar litros (Máximo, 2026-07-25: «esa medida de 600 es de los JAC
// y en Flotilla hay muchas marcas»). Y una tabla que sale de dividir la capacidad entre la
// altura tampoco sirve: eso es una división, no una medición — fue el error que hizo que
// el sistema cantara TANQUE LLENO a 46 cm cuando faltaban 65 L por meter.
//
// Acá se calcula de la geometría real: se integra el ancho de la sección a lo alto.
// Funciones PURAS (no tocan DOM ni red) → se pueden probar contra un tanque conocido.
//
// Los carros pequeños NO se cubican: su tanque es de plástico moldeado bajo el asiento y
// no se le puede meter la regla. Para esos se usa la capacidad de la ficha y el consumo
// se mide de carga a carga.
// ════════════════════════════════════════════════════════════════════════════

// ── UNA MEDIDA IMPOSIBLE SE RECHAZA, NO SE GUARDA (2026-08-17) ──────────────────────────────
// FC16 (MACK GU813) quedó con un tanque de 8.639 cm de diámetro y 8.909.645 litros: se le fue la
// coma al teclear y NADIE lo frenó. La verificación que ya existía corría SOLO para la forma
// 'redondeado' y SOLO si alguien declaraba la capacidad de fábrica — un cilindro o un cajón
// entraban con cualquier número.
// Un tanque de 8,9 millones de litros es PEOR que no tener tabla: el candado de la medición del
// chofer no muerde nunca (todo entra por debajo de 8.639 cm) y la app le canta litros inventados
// con dos decimales, que es justo lo que se cerró el 17/08 del lado del chofer. Faltaba cerrarlo
// del lado de quien carga la cubicación.
// LOS TOPES SE MIDIERON CONTRA LOS DATOS REALES, no se inventaron: los 12 tanques ya cargados van
// de 22 a 53 cm de alto, de 33 a 200 de ancho y de 40 a 199 de largo. La gracia se dejó enorme a
// propósito —admite hasta una cisterna de 60 m³— porque un candado que tranca a quien mide bien
// es peor que no tener candado.
var TQ_LIMITES={
  alto_cm:    {min:10, max:260,  lbl:'alto'},
  ancho_cm:   {min:10, max:260,  lbl:'ancho'},
  diametro_cm:{min:10, max:260,  lbl:'diámetro'},
  largo_cm:   {min:20, max:1300, lbl:'largo'},
  litros:     {min:20, max:60000}
};
// Devuelve el MOTIVO si la medida no puede ser de un tanque de camión; null si puede.
function medidaImposible(forma, m){
  var campos=(forma==='cilindro')?['diametro_cm','largo_cm']:['ancho_cm','alto_cm','largo_cm'];
  for(var i=0;i<campos.length;i++){
    var k=campos[i], L=TQ_LIMITES[k], v=Number(m[k])||0;
    if(!(v>0)) return 'Falta el '+L.lbl+'.';
    if(v<L.min) return 'El '+L.lbl+' de '+v+' cm es muy chico para un tanque de camión (menos de '+L.min+' cm). ¿Se midió en pulgadas, o se fue una coma?';
    if(v>L.max) return 'El '+L.lbl+' de '+v+' cm son '+(Math.round(v/100*10)/10)+' metros. Eso no es un tanque de camión: revisá si se te fue la coma.';
  }
  var alto=(forma==='cilindro')?(Number(m.diametro_cm)||0):(Number(m.alto_cm)||0);
  var litros=volumenHasta(forma,m,alto);
  if(litros<TQ_LIMITES.litros.min)
    return 'Con esas medidas el tanque da '+(Math.round(litros*10)/10)+' L: muy poco para un tanque de camión.';
  if(litros>TQ_LIMITES.litros.max)
    return 'Con esas medidas el tanque daría '+Math.round(litros).toLocaleString('es-VE')+' L. Ni una gandola cisterna llega a eso: revisá las medidas.';
  return null;
}

// Ancho (cm) de la sección transversal a la altura y, según la forma del tanque.
//   cilindro    : {diametro_cm}                       — el redondo de gandola, acostado
//   redondeado  : {ancho_cm, alto_cm, radio_cm}       — el de aluminio típico de camión
//   cajon       : {ancho_cm}                          — recto, mismo ancho de abajo a arriba
function anchoSeccion(forma, m, y){
  if(forma==='cilindro'){
    var r=(Number(m.diametro_cm)||0)/2;
    if(r<=0||y<0||y>2*r)return 0;
    var d=r-y;
    var s=r*r-d*d;
    return s>0 ? 2*Math.sqrt(s) : 0;
  }
  if(forma==='cajon'){
    var W=Number(m.ancho_cm)||0;
    var H=Number(m.alto_cm)||0;
    return (y<0||(H>0&&y>H))?0:W;
  }
  // redondeado: rectángulo ancho×alto con las 4 esquinas de radio r
  var W2=Number(m.ancho_cm)||0, H2=Number(m.alto_cm)||0, r2=Number(m.radio_cm)||0;
  if(W2<=0||H2<=0||y<0||y>H2)return 0;
  if(r2<=0)return W2;
  if(r2>W2/2)r2=W2/2;
  if(r2>H2/2)r2=H2/2;
  var dy=0;
  if(y<r2) dy=r2-y;                       // tramo de abajo (esquina)
  else if(y>H2-r2) dy=y-(H2-r2);          // tramo de arriba (esquina)
  else return W2;                          // panza: ancho completo
  var s2=r2*r2-dy*dy;
  return (W2-2*r2) + (s2>0 ? 2*Math.sqrt(s2) : 0);
}

// Volumen en LITROS hasta la altura h (cm). Integra el ancho por la altura y multiplica por el largo.
// Numérico a propósito: la forma redondeada no tiene una primitiva cómoda y el error de 2.000
// tajadas es despreciable frente a leer una regla en centímetros enteros.
function volumenHasta(forma, m, h){
  var alto = (forma==='cilindro') ? (Number(m.diametro_cm)||0) : (Number(m.alto_cm)||0);
  var L = Number(m.largo_cm)||0;
  if(L<=0||alto<=0)return 0;
  h=Number(h)||0; if(h<0)h=0; if(h>alto)h=alto;
  if(h===0)return 0;
  // Donde hay fórmula exacta se usa la fórmula: no se mete error numérico donde no lo hay.
  if(forma==='cajon'){
    return (Number(m.ancho_cm)||0)*L*h/1000;
  }
  if(forma==='cilindro'){
    var r=alto/2;
    var d=r-h;
    var seg=r*r*Math.acos(Math.max(-1,Math.min(1,d/r))) - d*Math.sqrt(Math.max(0,2*r*h-h*h));
    return seg*L/1000;
  }
  var N=2000, paso=h/N, area=0;
  for(var i=0;i<N;i++){
    var y0=i*paso, y1=y0+paso, ym=(y0+y1)/2;
    // Simpson por tajada: (a0 + 4·am + a1)/6
    area += paso*(anchoSeccion(forma,m,y0) + 4*anchoSeccion(forma,m,ym) + anchoSeccion(forma,m,y1))/6;
  }
  return area*L/1000;   // cm³ → litros
}

// Tabla REGLA → litros. El índice es lo que LEE LA REGLA, no la altura del tanque.
//
// ⛔ POR QUÉ NO ES LO MISMO. La regla puede entrar en diagonal o por un cuello corrido, y
//    entonces recorre MÁS que el alto del tanque: el FC17 tiene 27 cm de profundidad y su
//    regla llega a 48. Los LITROS salen de la geometría (que es correcta) y el ÍNDICE es lo
//    que la persona lee, así que la profundidad se escala:
//        profundidad = alto × (lectura de la regla / recorrido de la regla)
//
// 🔴 Hasta el 07/10/2026 la tabla se armaba sobre el ALTO, y por eso la del FC17 llegaba a 27:
//    todo lo que el chofer marcaba por encima —que era la medida BUENA— se quedaba sin litros.
//    Lo reclamó Junior Gregorio: «no permite que nosotros podamos meter la medición exacta que
//    da la regla». Tenía razón, y quien aforó también: eran dos mediciones, no una.
//
// `reglaCm` es OPCIONAL: sin él la tabla sale idéntica a antes (regla = alto), que es el caso
// del tanque leído con la regla a plomo y tocando fondo.
function tablaCubicacion(forma, m, reglaCm){
  var alto = (forma==='cilindro') ? (Number(m.diametro_cm)||0) : (Number(m.alto_cm)||0);
  var regla = Number(reglaCm)||0; if(!(regla>0)) regla = alto;
  var k = (regla>0) ? (alto/regla) : 1;        // 1 cm de REGLA = k cm de PROFUNDIDAD
  var t={};
  for(var cm=1; cm<=Math.floor(regla); cm++) t[cm]=Math.round(volumenHasta(forma,m,cm*k)*100)/100;
  if(regla>Math.floor(regla)) t[Math.round(regla*10)/10]=Math.round(volumenHasta(forma,m,regla*k)*100)/100;
  return t;
}

// EL RADIO DE LA ESQUINA casi nunca se puede medir con cinta, pero se DEDUCE: es el único
// valor que hace que el tanque dé su capacidad de fábrica. Si las tres medidas más la
// capacidad nominal cierran, eso es una verificación — no una suposición.
// Devuelve null si ni con esquinas rectas ni con el máximo redondeo se llega a la capacidad
// (o sea: las medidas y la capacidad no se corresponden, y hay que volver a medir).
function radioQueDaLaCapacidad(m, capacidadNominal){
  var cap=Number(capacidadNominal)||0;
  if(!(cap>0))return null;
  var alto=Number(m.alto_cm)||0, ancho=Number(m.ancho_cm)||0;
  if(alto<=0||ancho<=0)return null;
  var rMax=Math.min(ancho,alto)/2;
  var vSinRedondeo=volumenHasta('redondeado',Object.assign({},m,{radio_cm:0}),alto);
  var vMaxRedondeo=volumenHasta('redondeado',Object.assign({},m,{radio_cm:rMax}),alto);
  if(cap>vSinRedondeo || cap<vMaxRedondeo)return null;   // fuera de rango: las medidas no cuadran
  var lo=0, hi=rMax;
  for(var i=0;i<60;i++){
    var mid=(lo+hi)/2;
    var v=volumenHasta('redondeado',Object.assign({},m,{radio_cm:mid}),alto);
    if(v>cap) lo=mid; else hi=mid;      // más radio = menos volumen
  }
  return Math.round(((lo+hi)/2)*100)/100;
}

// Litros por cm A ESA ALTURA (pendiente local). Es lo que decide la tolerancia de la auditoría:
// un centímetro vale distinto en el fondo que en la panza. Ver norma de tolerancia por instrumento.
function litrosPorCm(forma, m, h){
  var a=volumenHasta(forma,m,Math.max(0,h-0.5));
  var b=volumenHasta(forma,m,h+0.5);
  return Math.round((b-a)*100)/100;
}

// Resumen para mostrar en pantalla ANTES de guardar: que quien mide vea si el número cierra.
function resumenCubicacion(forma, m, capacidadNominal){
  var alto=(forma==='cilindro')?(Number(m.diametro_cm)||0):(Number(m.alto_cm)||0);
  var total=volumenHasta(forma,m,alto);
  var cap=Number(capacidadNominal)||0;
  var dif=cap>0?(total-cap):null;
  return {
    alto_max_cm: Math.round(alto*10)/10,
    litros_al_tope: Math.round(total*100)/100,
    capacidad_declarada: cap||null,
    diferencia_l: dif==null?null:Math.round(dif*100)/100,
    diferencia_pct: (dif==null||!cap)?null:Math.round((dif/cap)*1000)/10,
    // Se miden en el PRIMER y el ÚLTIMO centímetro, que es donde la forma se nota: en un tanque
    // de esquinas redondeadas el primer cm da la mitad de litros que la panza. Si los tres
    // números son iguales, la tabla es una recta — o sea, el tanque es un cajón o alguien dividió.
    lcm_fondo: litrosPorCm(forma,m,1),
    lcm_panza: litrosPorCm(forma,m,alto/2),
    lcm_arriba: litrosPorCm(forma,m,Math.max(1,alto-1))
  };
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={anchoSeccion,volumenHasta,tablaCubicacion,radioQueDaLaCapacidad,litrosPorCm,resumenCubicacion};
}
