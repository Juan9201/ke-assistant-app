# 014 · La propuesta espera la foto y se mantiene al día — Aprobada

> Estado: **aprobada por Juan (2026-10-11, caso real "Troy again", SL Jade Herren: "no está examinando la imagen")** · Responsable: Juan

## Contexto para una IA
- Leer antes: `specs/constitution.md` (principio 1), spec 002 (panel), 003 (visión), 006 (consola).
- Caso real: el staff mandó una foto del ticket con el texto "Troy again…". El asistente propuso al instante preguntar parque, tarjeta y recibo (sin foto leída) y la insertó en el cuadro de Connecteam. La lectura de la foto terminó ~70 s después (parque, recibo y línea de flames bien leídos), pero la pregunta vieja siguió en el cuadro. Además la consulta a Gravity nunca fue atendida: caducó a los 90 s sin registro porque el panel dejó de esperar justo cuando caducaba.

## Requisitos
- **R-01** Si el mensaje trae foto, la propuesta DEBE esperar a que se lea la foto (máximo 120 s) antes de insertarse en el cuadro de Connecteam; mientras tanto el panel dice "Leyendo la foto antes de proponer la pregunta…".
- **R-02** Mientras el cuadro de Connecteam siga conteniendo EXACTAMENTE la sugerencia del asistente, DEBE actualizarse cuando la propuesta cambie (foto leída, lectura de Gravity, corrección en el panel o en la consola); si ya no hay nada que preguntar, se quita. Si una persona escribió o editó algo, NO se toca.
- **R-03** La pregunta solo DEBE pedir lo que aún falta tras texto + foto + lecturas (nunca el parque o el recibo que la foto ya trae).
- **R-04** Si el lector de Gravity no atiende la consulta, el panel DEBE decir hace cuánto no responde ("abre o activa la pestaña de Gravity") y esperar hasta 150 s; la consulta caduca a los 120 s y esa caducidad DEBE quedar en `/logs`.
- **R-05** El servidor DEBE conocer el último latido del lector de cada sistema.

## Criterios de aceptación
- **CA-01** Con foto, el cuadro de Connecteam no recibe la pregunta hasta que termina la lectura (o 120 s) (R-01).
- **CA-02** Tras leer la foto, el cuadro pasa de "parque, tarjeta y recibo" a solo lo que falta (R-02, R-03).
- **CA-03** Si Juan editó el texto del cuadro, la actualización no lo pisa (R-02).
- **CA-04** Con el lector de Gravity sin responder, el panel lo dice y, al caducar, `/logs` lo registra (R-04, R-05).

## Tareas
- [x] T-01 Latido del lector y caducidad de 120 s (`lookups.js`, `server.js`) · R-04, R-05
- [x] T-02 Listener v2.8.0: retener la propuesta mientras se lee la foto y mantener al día la sugerencia del cuadro · R-01..R-03
- [x] T-03 Aviso de lector sin respuesta en el panel · R-04
- [x] T-04 Prueba en el simulador de Connecteam · CA-01..CA-03
