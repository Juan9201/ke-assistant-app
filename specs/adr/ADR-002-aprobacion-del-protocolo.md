# ADR-002 — La aprobación humana pasa del clic final a la aprobación del protocolo completo

> Estado: **aceptada** · Fecha: 2026-10-05 · Decide: Juan · Enmienda: ADR-001

## Contexto
ADR-001 exige que Juan haga el clic final en `Credit` de Amusement. Juan pidió (2026-10-05) un botón verde en el panel
del listener que, al pulsarlo, ejecute **todo el protocolo** de la recarga. Hoy el flujo obliga a dos aprobaciones
(panel + clic final), lo que frena la validación por ensayo y error.

## Opciones
| Opción | Pros | Contras |
|---|---|---|
| A. Mantener clic final humano (ADR-001) | Máximo control | Dos aprobaciones por caso |
| B. El botón verde aprueba y ejecuta todo, incluido `Credit` | Una sola decisión humana, informada con lo que el asistente entendió | Si las guardas fallan, se acredita valor sin segundo control |

## Decisión
**B**, con estas condiciones (el humano sigue siendo el último paso: el clic verde es el acto de aprobación):
0. **Las 6 guardas del ADR-001 siguen vigentes** (recibo pagado, V1/V2, flames de la línea del recibo, anti doble recarga por Receipt ID, etc.).
   Lo único que cambia es *quién* da el último clic. El orden pasa a ser: el asistente hace primero todas las lecturas (Gravity y Amusement, R0),
   muestra la evidencia, y **solo entonces** aparece el botón verde.
1. El botón verde solo se habilita si TODAS las guardas pasan: tarjeta de 10 dígitos, tarjeta del chat = tarjeta del recibo, parque conocido,
   flames y monto presentes y dentro de tope, tarjeta sin esos flames ya cargados, no duplicado (`jobs.js` + ledger).
2. El panel muestra antes de aprobar: qué entendió, parque, tarjeta, flames/monto, quién lo pidió y la lista de pasos a ejecutar.
3. Un solo clic aprueba el protocolo completo; no hay ejecución sin clic (evento `isTrusted`).
4. Antes de pulsar `Credit`, el asistente verifica que "Credits Loaded per Card" == flames; si no, se detiene y escala (no carga).
5. Verificación posterior en el historial de la tarjeta y registro en la traza.
6. Reembolsos, anulaciones y cualquier otro movimiento de dinero siguen siendo R2 (siempre escalan).

## Consecuencias
- Positivas: una sola decisión humana por caso.
- Negativas: depende de que las guardas y la verificación previa al clic sean sólidas.
- Reabrir si: aparece un doble crédito o un monto incorrecto cargado → volver a la opción A.
