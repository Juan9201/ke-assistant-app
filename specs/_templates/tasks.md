# Tasks NNN — <nombre>

> Spec: `./spec.md` · Plan: `./plan.md`
> Formato: `- [ ] T-xx [P?] Descripción — archivos — cubre R-xx — verificación`
> `[P]` = puede hacerse en paralelo. Una tarea = un cambio pequeño y verificable.

## Fase 0 — Preparación
- [ ] T-01 …

## Fase 1 — Fundamentos (bloquea las demás)
- [ ] T-02 Tests/evals primero para R-01 — `kb/evals/…` — R-01 — fallan antes de implementar
- [ ] T-03 …

## Fase 2 — Capacidad principal
- [ ] T-04 [P] …
- [ ] T-05 [P] …

## Fase 3 — Integración y endurecimiento
- [ ] T-06 Manejo de errores y escalación — R-xx — simular falla, verificar `Allow me take a look`

## Fase 4 — Cierre
- [ ] T-07 Actualizar docs, `kb/docs/fts/CHANGELOG.md` y specs
- [ ] T-08 Revisión de secretos (ninguno en código/KB/trazas)

## Trazabilidad
| Requisito | Tareas | Criterio |
|---|---|---|
| R-01 | T-02, T-04 | CA-01 |
