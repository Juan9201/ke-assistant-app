# Plan 002 — Panel de entendimiento y aprobación

> Spec: `./spec.md` · Estado: aprobado · Fecha: 2026-10-05

## Contexto para una IA
Un extractor determinista (sin IA) en el servidor local analiza cada mensaje del chat y devuelve qué entendió, los datos capturados, los bloqueos y la pregunta en inglés si falta algo. El listener muestra el resultado en una tarjeta nueva con campos editables y un botón verde. Cuando el mensaje trata de flames, la tarjeta nueva reemplaza a la respuesta sugerida por IA. Archivos: `local-server/flamerequest.js` (+ test), `local-server/server.js`, `userscript/connecteam-listener-v2.user.js`.

## Verificación contra la constitución
| Principio | ¿Cumple? | Cómo |
|---|---|---|
| 1 Humano en el circuito | Sí | Nada se ejecuta sin clic humano en el botón verde; mensajes a Connecteam siguen siendo manuales |
| 2 KB fuente de verdad | Sí | Reglas de extracción de `playcard.md` (10 dígitos, teléfono ≠ tarjeta, confirmar candidato); pregunta de datos faltantes permitida |
| 3 La IA propone, el código decide | Sí | Extracción y guardas son código determinista; la IA no interviene en este flujo |
| 5 Secretos | Fase de validación | Sin cambios de secretos (cláusula vigente) |
| 7 Barato por defecto | Sí | $0 por mensaje en este flujo; visión se añade después (T-07) y solo con imagen |
| 8 Selectores estables | Sí | Panel en shadow DOM propio; sin clases hasheadas |
| 9 Idioma | Sí | Panel en español, preguntas al staff en inglés |

## Enfoque técnico
- **Extractor determinista** `analyzeFlameRequest()`: puro (texto + autor + correcciones → análisis). Se prueba con tests unitarios sin red.
- **Acción `analyze_flames`** en `server.js`, antes de `handleAction` (no necesita claves de IA ni GitHub). Autenticada con `X-Shared-Secret` como el resto.
- **El panel re-evalúa en el servidor** cada vez que Juan corrige un campo (con `overrides`), para que las guardas vivan en un solo lugar y no se dupliquen en el navegador.
- Descartado: pedirle la extracción al LLM (costo, no determinista, `deepseek-chat` no lee imágenes); duplicar guardas en el userscript.

## Componentes
| Componente | Archivo | Responsabilidad | Requisitos |
|---|---|---|---|
| Extractor y guardas | `local-server/flamerequest.js` | Detectar tema, extraer parque/tarjeta/flames/monto, bloqueos, pregunta en inglés, pasos | R-01, R-02, R-03, R-04, R-05, R-06, R-11 |
| Tests | `local-server/flamerequest.test.js` | CA-01, CA-02, CA-03 | CA-01..03 |
| Acción HTTP | `local-server/server.js` | `analyze_flames` | R-02 |
| Tarjeta del panel | `userscript/connecteam-listener-v2.user.js` | Mostrar entendimiento, campos editables, pregunta, pasos, verde/Negar | R-01..R-06, R-11 |
| Ejecución | `userscript/amusement-recharge.user.js` | Protocolo en Amusement | R-07, R-08, R-09 (T posteriores) |

## Contratos
Entrada `analyze_flames`: `{ action, text, author, mode?, overrides?: { parkKey, card, flames, amountUsd } }`
Salida: `{ isFlameRequest, understood, requester, mode, fields: { parkKey, parkName, locationId, card, cardConfirmed, flames, amountUsd, reason }, missing[], blockers[], question|null, canApprove, steps[] }`

## Datos y estado
No se persiste nada en esta fase (el análisis es sin estado). Los parques conocidos viven en una constante (Chandler 2364, Arlington 4809, Miami sin locationId) hasta leerlos de `kb/docs/parks.md`.

## Manejo de errores y escalación
| Falla | Detección | Respuesta |
|---|---|---|
| Servidor caído / secreto incorrecto | HTTP ≠ 2xx | Tarjeta de error en el panel; no se ejecuta nada |
| Tema no es de flames | `isFlameRequest = false` | Flujo anterior (interpret) |
| Dato faltante o inválido | `blockers` | Verde deshabilitado + pregunta en inglés |
| Parque sin locationId (Miami) | `blockers` | Verde deshabilitado, se explica el motivo |

## Estrategia de pruebas
- Unitarias: `node --test flamerequest.test.js` (CA-01, CA-02, CA-03, teléfono, ambiguo, tope de flames).
- Verificación manual con Juan: ver la tarjeta en un mensaje real; corregir un campo y ver el verde habilitarse.

## Seguridad
Esta fase no ejecuta acciones en sistemas (R0). El botón verde, en T-03, solo marca la aprobación en pantalla. La ejecución R1 (T-05 en adelante) cumple ADR-002.

## Preguntas abiertas
- Miami: falta su `locationId` de Amusement.
- Motivo de la recarga (`test_card` vs `webhook_failed`): por ahora se deduce de la palabra "test" en el mensaje.
