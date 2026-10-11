# ADR-001 — La recarga manual de flames es R1 con guardas, no R2

> Estado: **aceptada** · Fecha: 2026-10-02 · Decide: Juan

## Contexto
La constitución clasificaba como R2 (siempre escala) todo lo que mueve dinero o valor.
Cargar flames a mano en Amusement Connect mueve valor equivalente a dinero, pero es el trabajo
diario de soporte y Juan quiere que el agente lo prepare y ejecute.

## Opciones
| Opción | Pros | Contras |
|---|---|---|
| A. R2 (siempre escala) | Riesgo mínimo | El agente no resuelve el caso principal |
| B. R1 con guardas y aprobación humana | Automatiza el trabajo y conserva control | Requiere guardas bien probadas |
| C. R0 / autónomo | Máxima velocidad | Un error acredita valor sin control |

## Decisión
**B.** La recarga manual es **R1** y solo se ejecuta si se cumplen TODAS las guardas:
1. Recibo encontrado en Gravity y pagado con éxito.
2. V1 (10 dígitos) y V2 (tarjeta del chat = tarjeta del recibo) en verde.
3. Flames a cargar = los de la línea del recibo; una sola línea de flames.
4. Receipt ID ausente del registro local anti doble recarga.
5. **Juan aprueba el clic final en `Credit`** (humano en el último paso).
6. Verificación posterior: mensaje de éxito y entrada nueva en el historial de la tarjeta.

Reembolsos, anulaciones y cualquier otro movimiento de dinero siguen siendo **R2**.

## Consecuencias
- Positivas: el caso más frecuente se automatiza sin perder control.
- Negativas: depende de que el registro y las guardas funcionen; hay que mantener evals para ellas.
- Reabrir si: aparece un doble crédito, o si la aprobación se vuelve un cuello de botella (entonces
  decidir con evidencia de evals si se relaja la aprobación para casos de bajo monto).
