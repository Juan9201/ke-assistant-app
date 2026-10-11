# Tasks 006 — Consola de tickets

> Spec: `./spec.md` · Plan: `./plan.md`

- [x] T-01 Almacén de tickets persistente con hilo por autor y estados — `local-server/tickets.js` — R-01, R-02, R-03
- [x] T-02 Cola de comandos hacia Connecteam con caducidad — `local-server/commands.js` — R-06, R-07, R-08
- [x] T-03 Servidor: tickets en `analyze_flames`, lectura a Gravity por su cuenta, re-evaluación, acciones `ticket_*` y `command_*`, rutas `/tickets` y `/api/tickets` — `server.js`, `ticketsserver.js` — R-04..R-13
- [x] T-04 Consola: lista, conversación, datos editables, evidencia, logs, respuesta y aprobación — `tickets-ui/tickets.html` — R-03..R-09
- [x] T-05 Listener: manda `messageKey`, fotos y hora; ejecuta `insert_reply` y `send_reply` — userscript — R-06, R-07, R-08
- [x] T-06 Prueba en navegador con Connecteam simulado y cierre (docs, PR) — CA-01..CA-09

## Trazabilidad
| Requisito | Tareas | Criterio |
|---|---|---|
| R-01, R-02, R-03 | T-01, T-03, T-04 | CA-01, CA-02 |
| R-04, R-05, R-09 | T-03, T-04 | CA-06 |
| R-06, R-07, R-08 | T-02, T-03, T-05 | CA-03, CA-04, CA-05 |
| R-10, R-11 | T-03 | CA-06, CA-07 |
| R-12, R-13 | T-03 | CA-08, CA-09 |
