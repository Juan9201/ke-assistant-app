---
description: Crear un runbook de Gravity (y su política) en la KB a partir de un procedimiento que Juan describe
argument-hint: <tema, p. ej. consultar membresía>
---
Tema: $ARGUMENTS

1. Lee `specs/constitution.md`, `specs/_templates/runbook.yaml`, `specs/_templates/policy-module.md` y el módulo existente en `kb/docs/business-logic/` si lo hay.
2. Pide a Juan el procedimiento paso a paso tal como lo hace hoy en Gravity, los datos que necesita, qué ve al terminar y 2–3 casos reales anonimizados.
3. Crea/actualiza `kb/docs/business-logic/<tema>.md` y `kb/runbooks/<tema>.yaml`. Clasifica el riesgo R0/R1/R2; si hay duda, el nivel más restrictivo y autonomía "siempre debe escalar".
4. Usa selectores por rol/label, nunca clases hasheadas. No inventes pasos que Juan no describió: márcalos `TODO(Juan)`.
5. Termina proponiendo `/sdd-eval <tema>`.
