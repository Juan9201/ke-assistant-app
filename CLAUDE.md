# KE Assistant — guía para cualquier IA que trabaje aquí

Lee en este orden antes de tocar código:
1. `specs/constitution.md` — reglas innegociables (mandan sobre todo lo demás).
2. `PROJECT_BRIEF.md` — contexto y decisiones de arquitectura ya tomadas.
3. `specs/README.md` — flujo Spec-Driven Development (SDD).
4. La carpeta `specs/NNN-<feature>/` de la tarea en curso (`spec.md` → `plan.md` → `tasks.md`).

## Reglas de trabajo
- **Spec primero, código después.** No se implementa nada que no esté en un `spec.md` aprobado.
  El código nunca se adelanta a la spec; si la realidad contradice la spec, se actualiza la spec primero.
- Cada tarea de `tasks.md` es pequeña, verificable y referencia el requisito (`R-xx`) que cumple.
- Nunca enviar mensajes en Connecteam sin revisión humana. Nunca poner secretos en código, KB ni specs.
- No imprimir ni copiar valores de `.env` ni `SHARED_SECRET`.
- Cambios de comportamiento del agente = cambios en `kb/` (política/runbook) + un eval, no código a mano.

## Comandos SDD (consola de Claude Code)
`/sdd-spec` → `/sdd-clarify` → `/sdd-plan` → `/sdd-tasks` → `/sdd-implement` → `/sdd-analyze`
Más `/sdd-runbook` y `/sdd-eval` para conocimiento del agente.

## Mapa del repo
- `local-server/` backend Node (127.0.0.1) · `userscript/` listener Connecteam · `kb/` fuente de verdad
- `rule-editor/` editor de reglas · `worker/` alternativa Cloudflare · `specs/` especificaciones SDD
