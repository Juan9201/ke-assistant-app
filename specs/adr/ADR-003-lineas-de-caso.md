# ADR-003 — Líneas de caso y su registro en la constitución

> Estado: aceptada · Fecha: 2026-10-10 · Decide: Juan

## Contexto
Hay dos líneas operativas (Play Card, Refunds) y Juan quiere sumar Bookings, Punch Cards, Memberships, Online tickets y Split payment, armando la lógica de cada una sin que se contradigan reglas, planes ni tareas. Hasta ahora las reglas de cada tema vivían solo en su spec y en la KB.

## Opciones
| Opción | Pros | Contras |
|---|---|---|
| A. Cada spec define sus reglas por separado | Rápido | Riesgo de contradicciones entre líneas |
| B. Registro único en la constitución + reglas comunes + prueba de coherencia | Una fuente de verdad; se detectan huecos | Un paso más al crear una línea |

## Decisión
Elegimos B: la constitución lista las líneas de caso con sus specs, su módulo de KB y su estado, y fija las reglas comunes (protocolo propio, no tocar otras líneas, sin spec aprobada se escala, riesgo declarado, respuestas literales). `cases.test.js` verifica el registro.

## Consecuencias
- Positivas: cada línea nueva nace con spec, política de KB y límites claros; las ya operativas quedan protegidas.
- Negativas / deuda aceptada: cada línea nueva exige llenar su spec antes de responder sola.
- Qué habría que revisar si cambia: si dos líneas necesitan reglas distintas de precedencia, se amplía la regla 2.
