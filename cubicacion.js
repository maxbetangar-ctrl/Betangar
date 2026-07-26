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

// Tabla cm → litros, de 1 en 1 cm hasta la altura máxima (incluye el tope aunque sea fraccionario).
function tablaCubicacion(forma, m){
  var alto = (forma==='cilindro') ? (Number(m.diametro_cm)||0) : (Number(m.alto_cm)||0);
  var t={};
  for(var cm=1; cm<=Math.floor(alto); cm++) t[cm]=Math.round(volumenHasta(forma,m,cm)*100)/100;
  if(alto>Math.floor(alto)) t[Math.round(alto*10)/10]=Math.round(volumenHasta(forma,m,alto)*100)/100;
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
