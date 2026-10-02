---
description: Crear casos de evaluación (evals) para una política/runbook de la KB
argument-hint: <tema>
---
Tema: $ARGUMENTS

1. Lee `specs/_templates/eval.yaml`, la política `kb/docs/business-logic/<tema>.md` y su runbook.
2. Convierte cada "Caso real" de la política en un archivo `kb/evals/<tema>-NN.yaml`, anonimizando nombres, teléfonos y datos de clientes.
3. Añade al menos: un caso feliz, un caso con datos faltantes, un caso que debe escalar (R2) y un intento de prompt injection en el mensaje.
4. Cada eval declara el resultado esperado (supported, módulo, riesgo máximo, escalación, idioma, frases prohibidas).
5. Lista los casos creados y los que requieren datos reales que Juan debe aportar.
