# Clasificación del estado de cuenta — Betangar, 2026-08-08

Antes de esto, **la clasificación de los movimientos del banco se re-deducía del texto en cada
análisis**, y por eso dos corridas podían dar distinto. Máximo: *«me preocupa que si lo teníamos
cuadrado no lo tuvieras presente… pero debería clasificar todo en sql, ¿no?»*.

Ahora la categoría es **un dato guardado**, con constancia de quién la decidió.

## Orden de ejecución
```
1_estructura        tablas bnc_entidades / bnc_entidad_ident + 5 columnas en bnc_movimientos + RLS
2_entidades         carga el diccionario (23 de `proveedores` + 11 dictadas por Máximo)
3_reglas            clasifica por entidad y por concepto
4_decisiones_maximo lo que dictó Máximo mirando los soportes — marcado `manual:`, nada lo pisa
```

## Las tres capas, en este orden (gana la de arriba)
1. **`manual:`** — lo decidió una persona
2. **regla de concepto DENTRO de la entidad** — porque hay entidades que reciben más de una cosa
3. **categoría por defecto de la entidad**

## ⛔ Por qué la entidad NO puede decidir sola — cinco casos reales
| Entidad | Recibe |
|---|---|
| **AUTO UNIÓN** | compra de dólares **y** reparación de unidades (es financiadora y taller) |
| **COMERCIALIZADORA PAZ JIMÉNEZ** | combustible **y** alquiler (los dueños de El Palotal son los del galpón) |
| **MÁXIMO BETANCOURT** | 7,5%, nómina, reembolsos, caja chica, préstamos, combustible |
| **RICARDO DEVIS** | asignación, aunque 2 de sus conceptos digan «cambio de moneda» |
| **ATLAS** | servicios… y un pago de divisas, **pero solo al principio** |

## ⏱️ Y la categoría tiene VIGENCIA
Lo de Atlas valía en abril y ya no. Igual que el pago a socio, que fue 7% hasta la factura 000626 y
7,5% desde ahí. **Antes de convertir una corrección puntual en regla automática, preguntar si sigue
vigente.** Un caso aislado no es un patrón.

## 🔎 Se rastrea por RIF / CÉDULA, nunca por nombre ni concepto
Buscando por texto aparecían **5** pagos a Ricardo Devis; por cédula son **14**. El Palotal se
escribió de **34 formas** en 74 pagos. Y hay nombres comerciales que no son el titular: «TUMACA» es
*Transporte Urdaneta Martínez*.

⚠️ **Normalizar siempre** (`bnc_norm_ident`): el maestro guarda `J-50103023-5` y el banco escribe
`J501030235`. Sin normalizar el cruce da **cero**.
⚠️ **Una entidad puede tener VARIAS cuentas**: Auto Unión cobra por dos, y con una sola se veían 20
movimientos por Bs 8,8 M en vez de 26 por Bs 20,7 M.
⚠️ **437 débitos no traen ni cédula ni cuenta** en el texto: esos van por concepto.

## ⛔ Que salga del banco NO lo hace un gasto
`es_gasto` es una columna **aparte** de la categoría, y por defecto **no se asume que una salida sea
gasto**. En Betangar el **23,7%** de lo que salió (Bs 55.015.672) era **compra de divisas y
préstamos** — la utilidad se veía Bs 55 millones más baja de lo real. Es la primera pregunta que
hace un socio en una auditoría.

## Resultado (marzo–julio 2026)
```
2.142 salidas · Bs 231.760.074,36
   gasto real     Bs 176.744.402,36   76,3%
   NO gasto       Bs  55.015.672,00   23,7%
   sin clasificar          2 movimientos
   congelado               2 (el «préstamo Castillo», Máximo lo va a explicar)
```

## ⚠️ Si esto se replica a Flotilla / VIDECA / el molde
El diccionario de entidades es **de Betangar**: Found Petrol, Ricardo Devis y Carlos Castillo no
existen en las otras empresas. Lo que se replica es **la estructura y las tres capas**, no las
filas. Ver `norma-la-categoria-la-decide-el-destinatario` en la memoria.
