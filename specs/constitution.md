# Constitución — KE Assistant

> Versión 1.0 · Responsable: Juan · Cambios solo vía ADR (`specs/_templates/adr.md`).
> Si una spec, plan o tarea contradice este documento, gana este documento.

## Principios innegociables
1. **Humano en el último paso.** El sistema propone; una persona revisa y envía. Nunca se envía autónomamente a Connecteam.
2. **La KB es la fuente de verdad.** Si la KB no respalda algo, la respuesta es literalmente `Allow me take a look`. Nada de conocimiento externo ni suposiciones.
3. **La IA propone, el código decide.** Riesgo, autonomía, límites y aprobaciones se aplican en código determinista, no en el prompt.
4. **Menor privilegio.** Lectura antes que escritura; las acciones irreversibles o con dinero/seguridad/datos personales siempre escalan.
5. **Secretos fuera de todo.** Ni en código de navegador, ni en KB, ni en specs, ni en trazas. Sesiones de Gravity/Connecteam solo en perfil local del navegador.
6. **Reproducible y auditable.** Cada caso guarda traza con el sha de la KB usada; un comportamiento se puede reconstruir y evaluar.
7. **Barato por defecto.** Listener sin IA; modelo barato para clasificar; modelo fuerte solo si no hay runbook. Preferir endpoint interno > runbook determinista > agente exploratorio.
8. **Selectores estables.** Roles, labels y atributos semánticos; nunca clases hasheadas.
9. **Idioma.** Respuestas a clientes siempre en inglés; documentación interna en español.
10. **Spec antes que código** (ver `specs/README.md`).

## Niveles de riesgo de acciones
| Nivel | Definición | Política |
|---|---|---|
| R0 | Lectura | Puede ejecutarse sola |
| R1 | Escritura reversible | Requiere aprobación humana (hasta ganar autonomía por evals) |
| R2 | Irreversible, dinero, seguridad, datos personales | Siempre escala |

## Definición de "terminado"
Requisitos cumplidos y trazables · evals en verde · sin secretos · spec/plan/tasks actualizados · CHANGELOG de la KB si cambió conocimiento.

## Registro de enmiendas
| Fecha | ADR | Cambio |
|---|---|---|
