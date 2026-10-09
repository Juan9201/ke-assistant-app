# Tasks 002 — Panel de entendimiento, evidencia y aprobación

> Spec: `./spec.md` (revisada 2026-10-08) · Plan: `./plan.md` (pendiente de actualizar tras la comparación de librerías de la spec 003)
> Formato: `- [ ] T-xx [P?] Descripción — archivos — cubre R-xx — verificación`

## Hecho (versión previa de la spec)
- [x] T-01 Extractor determinista con tests — `local-server/flamerequest.js` — 15 tests en verde
- [x] T-02 Acción `analyze_flames` — `local-server/server.js`
- [x] T-03 Tarjeta del panel (entendió, datos editables, pasos, pregunta, verde/Negar) — `userscript/connecteam-listener-v2.user.js`

## Fase 1 — Ajustar lo hecho a la spec revisada
- [x] T-04 **Clasificar el pedido en un protocolo** (test card · con recibo · fuera de alcance) y quitar los modos — `flamerequest.js`, userscript — R-15, R-20 — CA-12, CA-14
- [x] T-05 **Capturar el Receipt Number y hablar como la KB, con nombre** (preguntas literales de la KB, siempre `Hello {nombre},`) — `flamerequest.js`, `logic.js` (nombre), userscript — R-02, R-03, R-04, R-17 — CA-02, CA-05, CA-13
- [x] T-06 **Logs: renombrar y conectar al flujo real** (`/logs`, `data/logs`, registro de lo que entiende el panel y de tu aprobación o negación) — `tracelog.js`, `traceserver.js`, `server.js`, userscript — spec 001 R-03, R-08, R-15 — spec 001 CA-05, CA-06, CA-08
- [ ] T-06b Logs: imprimir y descargar un caso — `trace-viewer` → `logs-viewer` — spec 001 R-14 — spec 001 CA-09, CA-10

- [x] T-06c Directorio de parques (127) conectado al extractor y al selector del panel — `kb/data/parks.json`, `parks.js`, `tools/parks-sync/` — spec 004 R-01, R-02, R-04, R-05
- [x] T-06d Contrato servidor↔userscript con versión, userscript servido en `/userscript/…user.js` y prueba de humo del servidor real — `server.test.js`

## Fase 2 — Lectura y evidencia (R0, antes del verde)
- [x] T-07 **Lectura del recibo en Gravity** por la API que usa Reports → pos-transaction (`/api/CheckOut/transactionDetail/{n}`), con un lector en tu pestaña de Gravity (`userscript/gravity-reader.user.js`), cola de consultas (`lookups.js`) y filtro de datos personales — R-05, R-08 — verificado en navegador con un Gravity simulado; **falta probarlo con tu Gravity real**
- [ ] T-08 **(siguiente)** Revisión del historial de la tarjeta en Amusement (`cardScanReports`) — runbook `amusement-revisar-tarjeta` — R-05, R-07 — verificación con Juan
- [x] T-09 **Veredicto A / B / escalar** con las validaciones de Gravity: recibo existe, parque, pagado, línea de flames, una sola línea, una sola tarjeta, PLAY_CARD y V2 (`gravity.js`), con las respuestas literales — R-06, R-08, R-09 — CA-04, CA-11 (falta: tope por motivo y anti doble recarga por Receipt Number, que van con T-11)
- [x] T-10 **Evidencia en el panel**: lista de validaciones con ✓/✗ y banner del caso A/B/escalar — R-05, R-09 — CA-01

## Fase 3 — Ejecución (R1, tras el verde)
- [ ] T-11 Conectar `jobs.js` al servidor y encolar al aprobar — R-09, R-10 — CA-10
- [ ] T-12 Protocolo en Amusement con verificación previa a `Credit` — `amusement-recharge.user.js` — R-10, R-11 — CA-08
- [ ] T-13 Verificación posterior, registro anti doble recarga y respuesta R-OK propuesta al autor — R-12, R-13 — CA-09

## Fase 4 — Visión (spec 003; plan propio)
- [x] T-14 Librería de lectura: RapidOCR (Python) elegida con 6 tickets reales; recibo acertado en 5/5 y miniatura de chat marcada como baja confianza (plan 003)
- [x] T-15 Captura de fotos del chat, lectura (OCR local) y visor con cajas y etiquetas; texto y foto del mismo autor se unen — `vision.js`, `kb/data/vision-keywords.json`, userscript v2.3.1 — spec 003 R-01..R-15 · pendiente de verificar en tu Connecteam real

- [ ] T-16 Consola de tickets (spec 006) y resiliencia a ráfagas (spec 005)

## Trazabilidad
| Requisito | Tareas | Criterio |
|---|---|---|
| R-01, R-02 | T-03, T-05 | CA-01 |
| R-03, R-04 | T-05 | CA-02, CA-05 |
| R-05 | T-07, T-08, T-10 | CA-01 |
| R-06, R-07, R-08 | T-09 | CA-04, CA-06, CA-11 |
| R-09 | T-09, T-11 | CA-03, CA-07, CA-10 |
| R-10, R-11 | T-11, T-12 | CA-08 |
| R-12, R-13 | T-13 | CA-09 |
| R-14 | T-03 | revisión manual |
| R-15 | T-04 | revisión manual |
| R-16 | T-06 | spec 001 CA-08 |
