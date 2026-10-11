# 007 · Saludo sin rango (bug) — Aprobada

## Problema (caso real, "* Crystal Mercado")
El asistente respondió «Hello *, allow me take a look, thank you!». El prefijo `*` es parte del nombre de usuario en
Connecteam, nunca un nombre. La ruta `interpret` (mensajes que no son de flames) lee el glosario desde GitHub
(copia que puede estar desactualizada y sin la fila `*`), mientras que la ruta de flames lee el glosario local.
Las pruebas solo cubrían el glosario local, por eso no se detectó.

## Requisitos
- **R-01** Un `*` como primera palabra del autor SIEMPRE se trata como prefijo y se omite al saludar, aunque la tabla
  de rangos usada no lo incluya (no depende de la fuente del glosario).
- **R-02** Los rangos de letras siguen dependiendo de la tabla (no se recortan nombres reales).
- **R-03** Un `*` solo (sin nombre) no inventa un saludo con `*`: se saluda sin nombre ("Hello,").
- **R-04** Prueba de regresión: tabla de rangos vacía + autor "* Crystal Mercado" → "Crystal".

## Tareas
- [x] T-01 `extractGreetingName` (logic.js y copia en worker) cumple R-01/R-03 · prueba R-04 en `greeting.test.js`.
