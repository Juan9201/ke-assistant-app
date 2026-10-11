# Spec 001 — Logs y página de logs ("qué pasa y qué se piensa")

> Estado: aprobada por Juan (2026-10-05) · **ajustada y aprobada 2026-10-08 (de "trazas" a "logs")** · Responsable: Juan
> La carpeta conserva el nombre `001-trace-log` por historia; en adelante todo se llama **logs**.

## Contexto para una IA
Cada mensaje que llega a Gravity Support recorre un ciclo de trabajo (entender → capturar → leer en Gravity y Amusement → validar → aprobar → ejecutar → responder).
Juan y cualquier otro usuario necesitan ver, caso por caso, qué ocurrió y qué se pensó, para afinar reglas, runbooks y prompts.
Los logs se ven en una **página aparte**, fuera de Connecteam, para no interferir con la experiencia de usuario del panel.
Leer antes: `specs/constitution.md` (principios 5 y 6), spec 002, spec 003.

## Requisitos
- **R-01** Cada caso produce un log: lista ordenada de eventos con hora, tipo, título, detalle y datos.
- **R-02** Tipos de evento: `input` (mensaje/imagen), `match` (qué palabras calzaron), `thought` (razonamiento), `extract` (datos hallados/faltantes), `vision` (qué leyó la foto, dónde y con qué confianza), `check` (V1, V2, guardas), `action` (paso en un sistema), `evidence` (qué se vio), `decision` (política aplicada), `approval` (aprobó o negó Juan), `reply` (respuesta propuesta/enviada), `escalation`, `error`.
- **R-03** Los logs se guardan como JSONL, un archivo por día, en `local-server/data/logs/` (carpeta fuera de git).
- **R-04** Ningún log guarda secretos: claves con nombres como `secret`, `token`, `apikey`, `password`, `authorization` se reemplazan por `[REDACTADO]`. Los logs de visión guardan hallazgos, no la imagen.
- **R-05** Un caso tiene un `outcome` final: `answered`, `asked_missing_data`, `prepared_for_human`, `executed`, `denied`, `escalated`, `error`.
- **R-06** La página de logs muestra los casos y su línea de tiempo, permite filtrar por resultado y buscar texto.
- **R-07** La página de logs no envía datos a ningún servidor externo.
- **R-08** Los logs se ven sin cargar archivos: el servidor local sirve la página en `http://127.0.0.1:8787/logs` y los datos en `/api/logs`.
- **R-09** Esas rutas son solo lectura, no envían cabeceras CORS (ninguna otra página puede leerlas) y rechazan un `Host` que no sea `127.0.0.1` o `localhost` (anti DNS-rebinding).
- **R-10** La página se actualiza sola cada 2 segundos ("en vivo") y muestra los pasos mientras ocurren, con barra de progreso y cronómetro.
- **R-11** Toda acción registrada declara su `system` y debe ser `connecteam`, `gravity` o `amusement`; cualquier otro valor se rechaza como "fuera de alcance".
- **R-12** Las búsquedas del agente se registran como eventos `action` con `where` (pantalla/elemento) y `query` (qué buscaba).
- **R-13** La página de logs es **independiente de Connecteam**: nunca se inyecta en su DOM y se abre en su propia pestaña o ventana.
- **R-14** La página permite **imprimir** un caso (estilo de impresión limpio, sin controles) y **descargar** el caso en un archivo.
- **R-15** Los logs están conectados al ciclo de trabajo real: el listener, el servidor y los protocolos escriben los eventos de cada fase, incluida la versión de la KB usada (constitución, principio 6).

## Fuera de alcance
- Autenticación de la página (es local, en 127.0.0.1).
- Envío de logs a servicios externos.

## Criterios de aceptación
- **CA-01** Dado un caso con eventos, cuando se cierra, entonces el archivo del día contiene una línea por evento y una de cierre con el outcome (R-01, R-03, R-05).
- **CA-02** Dado un dato con la clave `apiKey`, cuando se registra, entonces el archivo contiene `[REDACTADO]` y nunca el valor (R-04).
- **CA-03** Dados dos casos, cuando se abre `/logs`, entonces se listan ambos y al elegir uno se ve su línea de tiempo en orden (R-06).
- **CA-04** Un tipo de evento desconocido se rechaza (R-02).
- **CA-05** Dado un servidor con logs, cuando se pide `/api/logs` con Host local, entonces responde 200 con los casos y SIN `Access-Control-Allow-Origin` (R-08, R-09).
- **CA-06** Dado un `Host` externo, entonces responde 403 (R-09).
- **CA-07** Una acción con `system: "google"` se rechaza (R-11).
- **CA-08** Dado un caso real procesado por el panel, entonces aparece en `/logs` con sus eventos de cada fase (R-15).
- **CA-09** Al imprimir un caso, la salida no incluye botones ni filtros (R-14).
- **CA-10** La página `/logs` no añade ningún elemento al DOM de Connecteam (R-13).

## Migración
El código y los datos existentes usan el nombre "trazas" (`tracelog.js`, `traceserver.js`, `trace-viewer/`, `data/traces/`, ruta `/traces`). Un cambio de nombre en una tarea del plan los pasa a "logs"; mientras tanto la ruta `/traces` puede redirigir a `/logs`.
