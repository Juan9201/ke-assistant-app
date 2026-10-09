# Plan 006 — Consola de tickets

> Spec: `./spec.md` · Estado: aprobado · Fecha: 2026-10-09

## Contexto para una IA
Un almacén de tickets persistente en el servidor (`tickets.js`) agrupa los mensajes de cada staff y guarda el último análisis. Una página (`tickets-ui/tickets.html`) lista y opera los tickets. Las órdenes hacia Connecteam (insertar o enviar una respuesta) viajan por una cola de comandos (`commands.js`) que el listener, dentro de la pestaña de Connecteam, consulta y ejecuta. El servidor también pide solo las lecturas a Gravity y re-evalúa el ticket cuando llegan.

## Verificación contra la constitución
| Principio | ¿Cumple? | Cómo |
|---|---|---|
| 1 Humano en el circuito | Sí | Insertar no envía; enviar exige que el texto insertado coincida y una confirmación explícita en la consola; el verde sigue siendo una decisión humana |
| 3 La IA propone, el código decide | Sí | Todo el análisis es determinista (spec 002); los comandos validan su entrada |
| 5 Secretos | Sí | La página y los userscripts reciben el secreto del servidor al entregarse; el repo no lo lleva |
| 6 Auditable | Sí | Cada acción de la consola queda en los logs del caso |

## Enfoque técnico
- **Persistencia simple:** `data/tickets.json` (fuera de git), escritura atómica. Mensajes, hilo, análisis, correcciones y estado.
- **Hilo por autor:** un mensaje de un autor con un ticket que espera al staff (< 45 min) se suma a ese ticket; el análisis usa el texto combinado. Los `caseId` alternativos son alias del canónico.
- **Estados derivados:** nuevo · esperando al staff · rectificar (caso B) · listo para aprobar · escalado · negado · aprobado · resuelto. Los manuales (negado, aprobado, resuelto) son fijos.
- **Comandos:** `insert_reply` y `send_reply` hacia `connecteam`, con caducidad. El listener resuelve el mensaje a citar por id y, si no coincide, por contenido; `send_reply` compara el texto del cuadro con el esperado.
- **Servidor activo:** al llegar la lectura de Gravity o la foto, re-evalúa el ticket (no depende del widget).
- **Página:** una sola, sin dependencias externas; consulta cada 2 s; no pisa lo que se está escribiendo.
- Descartado: incrustar Connecteam en un iframe (no verificado, probablemente bloqueado); una base de datos (excesivo para el volumen).

## Componentes
| Componente | Archivo | Responsabilidad | Requisitos |
|---|---|---|---|
| Almacén de tickets | `local-server/tickets.js` | Crear, sumar mensajes, estado, persistencia | R-01, R-02, R-03 |
| Cola de comandos | `local-server/commands.js` | Órdenes a Connecteam con caducidad | R-06, R-07, R-08 |
| Rutas de lectura | `local-server/ticketsserver.js` | `/tickets`, `/api/tickets` (Host local, sin CORS) | R-04, R-12 |
| Acciones | `local-server/server.js` | `ticket_*`, `command_*`, integración con `analyze_flames` | R-05..R-11, R-13 |
| Consola | `tickets-ui/tickets.html` | Lista, conversación, edición, evidencia, logs, respuesta | R-03..R-09 |
| Ejecutor | `userscript/connecteam-listener-v2.user.js` | Consulta y ejecuta comandos; manda `messageKey`, fotos y hora | R-06, R-07 |

## Contratos
`analyze_flames` (entrada): suma `messageKey`, `messageId`, `images[]`, `ts`. (salida): suma `ticket: { id, number, caseId, status }`.
`ticket_reply`: `{ ticketId, text, mode: "insert" | "send" }` → `{ command: { id } }`.
`command_next`: `{ target: "connecteam" }` → `{ command: { id, type, params } | null }`. `command_result`: `{ id, ok, error? }`.

## Datos y estado
Tickets: texto de los mensajes, URLs de fotos, análisis (datos operativos y evidencia sin datos personales), hilo y estado. Nunca: contraseñas, datos de pago ni la imagen.

## Manejo de errores y escalación
| Falla | Detección | Respuesta |
|---|---|---|
| Connecteam cerrado o en otro chat | El comando caduca o el listener responde "chat incorrecto" | La consola muestra el motivo y permite reintentar |
| El cuadro de texto cambió antes de enviar | `send_reply` compara el texto | No se envía; se explica |
| El mensaje a citar no está en pantalla | No se encuentra por id ni por contenido | Se inserta sin cita y se avisa |
| Servidor reiniciado | — | Los tickets se recargan de disco |

## Estrategia de pruebas
- Unitarias: `tickets.test.js`, `commands.test.js`.
- Humo del servidor real: tickets, hilo, comandos, auth y CORS.
- En navegador con Connecteam simulado: la consola inserta en el chat falso citando el mensaje.
- Humana: con un caso real de Connecteam.

## Seguridad
La página solo se entrega a Host local y lleva el secreto; sin CORS no puede leerla otra web. `/api/tickets` es solo lectura con Host local. Los comandos exigen el secreto y validan tipo y largo.

## Preguntas abiertas
- Si el widget y la consola deben poder aprobar el mismo ticket a la vez (por ahora gana el primero).
