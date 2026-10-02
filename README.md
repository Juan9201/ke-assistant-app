# KE Assistant — asistente de soporte para Gravity Support

Detecta mensajes nuevos en Connecteam → los interpreta contra la base de conocimiento
en GitHub → deja una respuesta sugerida en el cuadro de texto. **Nunca envía nada solo:
tú revisas y presionas enviar.** Contexto completo y decisiones: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

```
kb/                                   → contenido del repo de GitHub (base de conocimiento)
local-server/                         → backend como servidor Node local (por defecto)
  logic.js                            → lógica de negocio: GitHub, prompt, proveedores de IA
  server.js                           → solo capa HTTP (Express-like con `http` nativo), escucha en 127.0.0.1
worker/src/worker-v3.js               → el mismo backend, como Cloudflare Worker (alternativa)
worker/wrangler.toml                  → configuración de despliegue del Worker
userscript/connecteam-listener-v2.user.js → Tampermonkey: escucha el chat, sin IA
rule-editor/rule-editor.html          → UI para crear/editar reglas (commit a GitHub)
```

`local-server` y `worker` implementan las mismas 4 acciones (`interpret`, `list_rules`,
`get_rule`, `save_rule`) con la misma lógica de negocio — la única diferencia es la capa de
transporte. Usa `local-server` si quieres correr todo en tu máquina sin depender de
Cloudflare; usa `worker` si prefieres que el backend esté siempre disponible aunque tu
máquina esté apagada. El userscript y `rule-editor.html` le hablan al que sea por HTTP, así
que solo necesitas cambiar una URL para pasar de uno a otro.

## Placeholders que debes reemplazar

| Archivo | Placeholder | Qué poner |
|---|---|---|
| `local-server/.env` (copia de `.env.example`) | todos los campos vacíos | Ver tabla de variables abajo |
| `worker/wrangler.toml` (solo si usas Cloudflare) | `TU_USUARIO_GITHUB` | Tu usuario u organización de GitHub |
| `worker/wrangler.toml` (solo si usas Cloudflare) | `ke-knowledge-base` | Nombre del repo donde subiste `kb/` |
| `userscript/connecteam-listener-v2.user.js` | `BACKEND_URL` | `http://localhost:8787` (ya viene así) o la URL del Worker |
| `userscript/connecteam-listener-v2.user.js` | `PEGA_AQUI_EL_MISMO_SHARED_SECRET_DEL_BACKEND` | Tu `SHARED_SECRET` |
| `userscript/connecteam-listener-v2.user.js` | `IGNORE_AUTHORS` | Ya viene con el equipo interno; agrega/quita nombres si el equipo cambia |
| `userscript/connecteam-listener-v2.user.js` | `CHANNEL_URL_FRAGMENT` (opcional) | Id del chat de Gravity Support en la URL |
| `userscript/connecteam-listener-v2.user.js` | `@namespace` (cosmético) | Tu usuario de GitHub |
| `rule-editor/rule-editor.html` | `DEFAULT_WORKER_URL` / `DEFAULT_SHARED_SECRET` | Ya vienen para el server local; o usa el botón **Configuración** |

Secrets — nunca en código, solo en `local-server/.env` (o con `wrangler secret put` si usas
Cloudflare): `LLM_PROVIDER`, `LLM_API_KEY`, `SHARED_SECRET`, `GITHUB_TOKEN`.

## 1. Subir la base de conocimiento a GitHub

1. Crea en GitHub un repo **privado** vacío, por ejemplo `ke-knowledge-base`.
2. Súbele el contenido de `kb/` como raíz del repo:

```bash
cd kb
```

```bash
git init -b main
```

```bash
git add . && git commit -m "Estructura inicial de la base de conocimiento"
```

```bash
git remote add origin https://github.com/TU_USUARIO_GITHUB/ke-knowledge-base.git
```

```bash
git push -u origin main
```

> Si prefieres un solo repo para todo el proyecto, sube la carpeta raíz y pon
> `KB_ROOT = "kb"` en `worker/wrangler.toml`.

## 2. Crear el token de GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
- Repository access: **Only select repositories** → solo `ke-knowledge-base`.
- Permissions → Repository → **Contents: Read and write**. Nada más.

## 3. Levantar el backend

### Opción A — server local (por defecto, recomendado para empezar)

```bash
cd local-server
```

```bash
npm install
```

```bash
cp .env.example .env
```

Llena `.env` con tus valores reales (`LLM_PROVIDER`, `LLM_API_KEY`, `SHARED_SECRET` —
genera uno largo, p. ej. con `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`
—, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`). Luego:

```bash
npm start
```

Escucha SOLO en `127.0.0.1:8787` (o el puerto que pongas en `PORT`), nunca en `0.0.0.0` —
nada fuera de tu máquina puede llamarlo. Pruébalo:

```bash
curl http://127.0.0.1:8787/health
```

```bash
curl -X POST http://127.0.0.1:8787 -H "Content-Type: application/json" -H "X-Shared-Secret: TU_SECRETO" -d "{\"action\":\"interpret\",\"message\":\"How do I check a membership status?\"}"
```

(debería contestar `Allow me take a look`, porque `membresias.md` está en "siempre debe
escalar"). Debes dejar esta terminal abierta (o correrlo con `pm2`/como servicio) mientras
uses el userscript.

### Opción B — Cloudflare Worker (si prefieres no depender de que tu máquina esté encendida)

```bash
cd worker
```

```bash
npm install
```

```bash
npx wrangler login
```

Edita `worker/wrangler.toml` (placeholders de la tabla de arriba) y carga los secrets; cada
comando te pide el valor:

```bash
npx wrangler secret put LLM_PROVIDER
```
(`deepseek`, `openai` o `anthropic`)

```bash
npx wrangler secret put LLM_API_KEY
```

```bash
npx wrangler secret put SHARED_SECRET
```

```bash
npx wrangler secret put GITHUB_TOKEN
```

```bash
npm run deploy
```

Wrangler imprime la URL (`https://ke-assistant.<tu-subdominio>.workers.dev`). Pruébala igual
que en la Opción A, cambiando la URL. Para ver logs en vivo: `npm run tail`. Si eliges esta
opción, cambia `BACKEND_URL` (userscript) y la URL del backend (rule-editor) de
`http://localhost:8787` a la URL de Cloudflare.

## 4. Instalar el userscript

1. Instala Tampermonkey en tu navegador.
2. Tampermonkey → Crear nuevo script → pega `userscript/connecteam-listener-v2.user.js`.
3. Reemplaza los placeholders de `CONFIG` y guarda.
4. Abre Connecteam en el chat de Gravity Support. Verás el panel **KE Assistant** abajo a la derecha.
5. Pulsa **"Probar cuadro"** en el panel — pega un texto de prueba sin depender del backend ni de
   GitHub. Si dice "No encontré el cuadro", inspecciona el cuadro con DevTools y ajusta
   `COMPOSER_SELECTORS` (atributos como `role`, `placeholder`, `data-*` — **no** clases hasheadas
   tipo `go29332765461`). Si funciona, ya puedes usar el pipeline completo (`interpret`).
6. El botón **"Enviar"** de cada tarjeta (rojo) presiona el botón real de "Send" de Connecteam —
   solo se habilita después de que el texto quedó insertado, y pide confirmación antes de hacer
   clic. Es una suposición sin verificar (`SEND_BUTTON_SELECTORS`): inspecciona el botón real de
   enviar con DevTools antes de confiar en él. Sigue habiendo revisión humana (tu clic + la
   confirmación), nunca se envía nada por su cuenta.
7. Antes de insertar, el asistente intenta activar el **"Reply" nativo** de Connecteam sobre el
   mensaje exacto que se está respondiendo (`replyButton` en `SEL`, confirmado con DevTools), para
   que quede citado y no parezca un mensaje suelto a todo el canal. Si el mensaje ya salió de la
   parte visible del chat (lista virtualizada) o el botón no aparece, se degrada solo a insertar el
   texto sin cita — nunca bloquea el flujo por esto. Pon `USE_NATIVE_REPLY: false` en `CONFIG` si
   te da problemas.
8. **Importante — el botón "Enviar" no es la única protección.** El cuadro de texto real de
   Connecteam sigue teniendo su Enter nativo. Si presionas Enter mientras el cuadro tiene EXACTO
   una sugerencia sin editar, el userscript lo intercepta y lo redirige a la misma confirmación del
   botón "Enviar" — así un Enter por reflejo no manda nada sin pasar por la confirmación. En cuanto
   editas el texto (o escribes el tuyo), esto se desactiva solo y Enter vuelve a enviar normal, como
   cualquier mensaje tuyo.

Colores de las tarjetas: **blanca** = respaldada y con autonomía total · **amarilla** = "con
aviso", revisa con cuidado · **gris** = `Allow me take a look` (abre "Por qué" para ver el motivo
y, si existe, el borrador interno que no se insertó).

## 5. Usar el editor de reglas

Abre `rule-editor/rule-editor.html` con doble clic (funciona como archivo local). Ya viene
apuntando a `http://localhost:8787`; si usas el Worker de Cloudflare en vez del server
local, pulsa **Configuración** y pega la URL real y el `SHARED_SECRET`. Cada **Guardar** es
un commit real en GitHub; el backend usa el cambio en la siguiente interpretación.

## Cómo decide el backend (resumen)

1. Lee en vivo todos los `.md` de `docs/business-logic/` (menos `_TEMPLATE.md`) y `docs/glosario.md`.
2. Pide al modelo un JSON `{ case_action, case_id, case_category, supported, module, answer, reason }`.
3. Del lado del servidor, responde `Allow me take a look` si: el modelo no está seguro, cita un
   módulo que no existe, la respuesta no se pudo leer, o el módulo está en **siempre debe escalar**
   (un módulo sin nivel válido cuenta como "siempre debe escalar").
4. Cambiar de proveedor = cambiar el secret `LLM_PROVIDER` (y opcionalmente `LLM_MODEL`).

## Memoria de conversación (solo en `local-server`)

Para no saludar en cada mensaje ni perder el hilo, `local-server/conversations.js` guarda un
registro liviano por persona en `local-server/data/conversations.json` (se crea solo, **nunca**
se sube a GitHub — está en `.gitignore`, a diferencia de `kb/`):

- **Casos**: cada persona puede tener varios casos abiertos a la vez (ej. un problema de tarjetas
  de juego y un booking, simultáneos). En cada mensaje nuevo, el modelo decide si continúa uno de
  los casos abiertos de esa persona (mismo tema) o abre uno nuevo, y le pone una categoría corta
  (ej. `game_card`, `booking_issue`). Esa decisión la valida el servidor contra los casos que
  de verdad existen — nunca confía ciegamente en el id que devuelve el modelo.
- **Saludo una sola vez por caso**: si el caso es nuevo, saluda con el nombre; si continúa uno
  existente, no vuelve a saludar. El mensaje de escalación (determinístico) respeta esto mismo
  del lado del servidor, sin depender de que el modelo lo haga bien.
- **Se borra solo a las 24 horas**: cualquier caso sin actividad en 24h se elimina en el
  siguiente mensaje que llegue (limpieza perezosa, sin proceso aparte). Pensado para que los
  casos se resuelvan en su ventana normal (unas pocas horas), no para guardar historial permanente.
- En el panel, cada tarjeta muestra una insignia morada con la categoría y si es caso nuevo o
  continuación (pasa el mouse para ver el id completo).
- Esta memoria **no existe en `worker-v3.js`** (Cloudflare Workers no tiene sistema de archivos
  local) — si algún día cambias al Worker, vuelve a saludar en cada mensaje hasta que se agregue
  con Workers KV o Durable Objects.
