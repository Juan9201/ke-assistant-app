# KE Assistant — traspaso (2026-10-09)

Lee primero `CLAUDE.md` y `specs/constitution.md`. Este documento dice qué hay, cómo se corre y qué falta.

## Qué es
Agente que lee pedidos de flames del canal **Gravity Support** (Connecteam), los entiende, valida el recibo en **Gravity** y, con un clic
humano (botón verde), recarga la tarjeta en **Amusement Connect**. Responde en inglés al staff, siempre nombrándolo. El humano envía.

## Cómo se corre
1. `cd local-server && npm install` (una vez) y configurar `local-server/.env` (ver `.env.example`; **nunca se sube**).
2. `local-server/start-ke-assistant.bat` (o `npm start`) → servidor en `127.0.0.1:8787`.
3. Instalar los userscripts **desde el servidor** (él les pone el secreto): abrir en Chrome con el servidor corriendo
   - `http://127.0.0.1:8787/userscript/connecteam-listener-v2.user.js` (panel en Connecteam)
   - `http://127.0.0.1:8787/userscript/gravity-reader.user.js` (lector de solo lectura; dejar una pestaña de Gravity abierta con sesión)
4. Logs en vivo: `http://127.0.0.1:8787/logs`.
5. Pruebas: `cd local-server && npm test` (≈170). Evaluar la visión con fotos reales: `npm run vision:eval` y `npm run vision:e2e`.

## Qué está hecho (ver `specs/002-panel-aprobacion/tasks.md`)
| Pieza | Dónde |
|---|---|
| Entendimiento determinista: protocolos (test card · con recibo · fuera de alcance), Receipt Number, respuestas literales de la KB con nombre | `local-server/flamerequest.js` |
| Directorio de 127 parques (Gravity venue ↔ Amusement locationId) | `kb/data/parks.json` (generado por `tools/parks-sync/`), `local-server/parks.js` |
| Visión: OCR local (Python + RapidOCR), tipo de documento (papel / pantalla de Gravity), reintento ampliado con votación, visor con cajas en el panel | `local-server/vision.js`, `tools/vision-lab/ocr_read.py`, `kb/data/vision-keywords.json` |
| Lectura del recibo en Gravity y veredicto A / B / escalar | `local-server/gravity.js`, `lookups.js`, `userscript/gravity-reader.user.js` |
| Logs de cada caso (qué entendió, leyó, validó y decidió) | `local-server/logs.js`, `flowlog.js`, `logs-viewer/` |
| Panel del listener | `userscript/connecteam-listener-v2.user.js` |

## Reglas de Juan que mandan
- Humano en el circuito: el botón verde aprueba el protocolo completo; las guardas por código mandan (ADR-001, ADR-002).
- Dos protocolos por contenido: `test`+`card` → $10 = 50 flames sin recibo; si no, con recibo.
- Un recibo sin línea de flames NO se escala: Gravity decide caso A (falló Gravity→Amusement) o B (recibo/tarjeta equivocados → R-V2).
- Se escala: no pagado, varias líneas de flames, varias tarjetas, recibo sin `PLAY_CARD`, reembolsos, tarjeta dañada.
- Toda respuesta nombra a la persona (`Hello Rashel,`), sin rango (AM, M, C, RTM, `*`).
- `Transaction #` = Receipt Number; `PLAY_CARD` = `gpCards[].code`; los 4 dígitos de `Card Account` son del pago.

## Qué falta
1. **T-08**: revisar el historial de la tarjeta en Amusement (`cardScanReports`) → con eso se habilita el botón verde.
2. **T-11 a T-13**: ejecución de la recarga (cola, protocolo en Manual Kiosk con verificación previa a `Credit`, anti doble recarga, respuesta R-OK).
3. Spec 004: actualización automática del directorio de parques cada lunes.
4. Spec 005 (resiliencia a ráfagas: el listener hoy puede perder mensajes si llegan varios a la vez) y spec 006 (consola de tickets).
5. Verificar en el Connecteam y el Gravity **reales**: lector de Gravity, foto ampliada desde el visor de Connecteam, ids de mensaje.

## Seguridad
- **El repositorio es PÚBLICO.** No hay secretos en él: los userscripts llevan el marcador `__SHARED_SECRET__`, que el servidor reemplaza al entregarlos. `local-server/repo-guard.test.js` falla si aparece un secreto real.
- Fuera de git: `local-server/.env`, `local-server/data/` (logs con mensajes REALES del chat; no borrar), `IMG Training/` (fotos con datos de huéspedes), `kb/` (repo aparte).
- `rule-editor/rule-editor.html` conserva el secreto solo en el PC de Juan (git lo protege con `skip-worktree`).
- Fase de validación (ver constitución): antes de desplegar en otro PC, rotar el `SHARED_SECRET`.
