# Spec 004 — Directorio de parques sincronizado (Gravity ↔ Amusement ↔ Connecteam)

> Estado: **aprobada por Juan (pedido explícito 2026-10-09) · lista inicial HECHA** (instantánea del 2026-10-09; falta automatizar la actualización de los lunes) · Responsable: Juan

## Contexto para una IA
- Qué es esto en una frase: una lista única de parques con su nombre, su `venue` de Gravity y su `locationId` de Amusement, que el asistente consulta para trabajar sincronizado entre Gravity, Amusement y Connecteam, y que se actualiza cada lunes.
- Leer antes: `specs/constitution.md` (principios 4, 5, 8), `kb/docs/parks.md`.
- Glosario: venue = id del parque en Gravity (`access.thegravityapp.io/company/1/venue/{id}`) · locationId = id del parque en Amusement (`ManualKiosk?locationId={id}`).

## Problema y motivación
La empresa abre parques nuevos cada mes. Hoy `parks.md` se llena a mano y tiene vacíos (Miami, Chandler en Gravity, etc.). Sin el directorio, el asistente no sabe a qué `locationId` ir.

## Requisitos funcionales
- **R-01** El sistema DEBE mantener un directorio con, por parque: nombre corto (`Marietta`), código (`GA-Marietta`), venue de Gravity y locationId de Amusement.
- **R-02** El directorio DEBE obtenerse leyendo las pantallas de Gravity (selector de parques y URL `/company/1/venue/{id}`) y de Amusement (desplegable del Manual Kiosk), **usando la sesión ya iniciada de Juan en Chrome**.
- **R-03** El directorio DEBE actualizarse **cada lunes** y también a pedido.
- **R-04** Un parque debe emparejarse entre Gravity y Amusement por su código (`GA-Marietta`); si un parque aparece en uno y no en el otro, se marca como "sin emparejar" y no se usa para recargar.
- **R-05** El directorio DEBE usarse en el panel (parque del ticket/chat → locationId) y en los protocolos.
- **R-06** La actualización DEBE ser de solo lectura (R0) y quedar en los logs.
- **R-07** La actualización NO DEBE guardar ni pedir contraseñas; si la sesión caducó, avisa para que Juan inicie sesión él mismo.

## Fuera de alcance
- Modificar datos en Gravity o Amusement.
- Guardar credenciales en código, KB, specs o logs.

## Criterios de aceptación
- **CA-01** Dada una sesión activa, cuando se actualiza, entonces el directorio contiene los parques con venue y locationId emparejados (R-01, R-02, R-04).
- **CA-02** Dado un parque nuevo en Gravity y en Amusement, cuando llega el lunes, entonces aparece en el directorio sin edición manual (R-03).
- **CA-03** Dado un parque solo en uno de los sistemas, entonces queda "sin emparejar" y el verde no se habilita para él (R-04).
- **CA-04** Con la sesión caducada, la actualización se detiene y lo dice, sin pedir contraseña (R-07).

## Riesgos y supuestos
- **K-01** Se asume que el selector de parques de Gravity y el desplegable del Manual Kiosk muestran todos los parques activos.
- **K-02** Un listener en el navegador solo corre cuando Chrome está abierto: "cada lunes" significa "la primera vez que Chrome abre Gravity o Amusement el lunes, o si el directorio tiene más de 7 días".

## Avance (2026-10-09)
- Hecho: lista de 127 parques de Gravity emparejados con Amusement (`kb/data/parks.json`, `kb/docs/parks.md`), generada por `tools/parks-sync/build-parks.mjs` a partir de lecturas de solo lectura con la sesión de Juan (R-01, R-02, R-04, R-05).
- Hallazgos: CA-Moreno Valley vive en otra organización de Amusement (locationId 1432); NY-Commack (Amusement 4750) no está en Gravity; el `locationId` de la API de Gravity es un GUID, no el número de Amusement.
- Pendiente: la actualización automática de los lunes (R-03, R-06, R-07).
