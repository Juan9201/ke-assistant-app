// ==UserScript==
// @name         KE Assistant — Connecteam listener v2
// @namespace    https://github.com/Juan9201/ke-assistant
// @version      2.0.0
// @description  Detecta mensajes nuevos en Gravity Support y sugiere una respuesta. Solo envía si tú haces clic en "Enviar".
// @match        https://app.connecteam.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==
//
// Si usas un dominio propio para el Worker, agrega otra línea `// @connect tu-dominio.com`.

(function () {
  "use strict";

  /* ================================================================ */
  /* CONFIGURACIÓN — reemplaza los placeholders                        */
  /* ================================================================ */
  const CONFIG = {
    // Backend: por defecto el server local (local-server/), sin barra final.
    // Si en vez de eso usas el Worker de Cloudflare, pon aquí la URL que imprime
    // `npm run deploy` (algo como https://ke-assistant.tu-subdominio.workers.dev).
    BACKEND_URL: "http://localhost:8787",
    // El mismo valor que pusiste en local-server/.env (SHARED_SECRET) o, si usas
    // Cloudflare, el que pusiste con `wrangler secret put SHARED_SECRET`.
    SHARED_SECRET: "PEGA_AQUI_EL_MISMO_SHARED_SECRET_DEL_BACKEND",
    // Nombres del equipo interno de soporte (Foxihost), tal como aparecen en el
    // chat. Sus mensajes en Gravity Support NUNCA se interpretan (ni se llama a
    // la IA) porque el equipo se coordina entre sí por Slack, no por este chat.
    IGNORE_AUTHORS: [
      "Juan Garcia",
      "Silvia Hernandez",
      "Jorge Lira",
      "Manuel Ruiz",
      "Yeison Berrio",
      "Andre Ho",
      "James Tully",
      "Pierre Goriel",
    ],
    // Nombre del canal (se lee del header de Connecteam) al que debe limitarse
    // el listener. "" = actuar en cualquier chat abierto.
    CHANNEL_NAME_FRAGMENT: "Gravity Support",
    // Opcional: además del nombre, restringe también por URL si hace falta.
    // "" = no filtrar por URL.
    CHANNEL_URL_FRAGMENT: "",
    // Si el cuadro de texto está vacío, pega la sugerencia automáticamente (sin enviarla).
    AUTO_INSERT_WHEN_EMPTY: true,
    // Selectores del cuadro de texto, en orden de preferencia. Verifícalos con DevTools
    // (clic derecho sobre el cuadro → Inspeccionar). Evita clases hasheadas tipo go123456.
    COMPOSER_SELECTORS: [
      '[contenteditable="true"][role="textbox"]',
      '.chat-input [contenteditable="true"]',
      '[placeholder*="write something" i]',
      '[data-placeholder*="write something" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="mensaje" i]',
    ],
    // Selectores del botón "Enviar" de Connecteam. SUPOSICIONES sin verificar
    // contra el DOM real — inspecciona el botón de enviar con DevTools antes
    // de confiar en el botón "Enviar" del panel. Se busca SOLO cerca del
    // cuadro de texto (nunca en toda la página) para no hacer clic por error
    // en un botón no relacionado.
    SEND_BUTTON_SELECTORS: [
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
      'button[type="submit"]',
    ],
    // Si Connecteam permite responder directamente a un mensaje ("Reply"), el
    // asistente lo activa ANTES de insertar el texto, para que la respuesta
    // quede citando el mensaje original en vez de aparecer como un mensaje
    // suelto dirigido a todo el canal. Ponlo en false si te da problemas.
    USE_NATIVE_REPLY: true,
    DEBUG: false,
  };

  // Selectores semánticos de Connecteam. La extracción de texto, `.me` y el
  // título del canal vienen confirmados contra el DOM real (verificados con un
  // listener de solo lectura ya en producción); el resto sigue el patrón
  // documentado en el brief. Evita clases hasheadas tipo go29332765461.
  const SEL = {
    messageWrapper: "[data-message-id]", // envuelve a .chat-message, trae el id real
    message: ".chat-message",
    author: ".user-name-container",
    textWrapper: ".hour-and-caption-container", // envuelve la hora + la burbuja de texto
    text: ".text-bubble",
    markdown: ".markdown-content-module__markdownContainer",
    plainSpan: 'span[dir="auto"]',
    replyQuote: ".reply-message-module__text",
    channelTitle: '.conversation-description-card-module__titleContainer span, [data-testid="text"]',
    // Botón "Reply" de un mensaje específico. Confirmado por Juan con DevTools
    // contra el DOM real de Connecteam.
    replyButton: '[data-testid="automation-reply-message-option"]',
  };

  const QUIET_MS = 2500; // tiempo sin cambios para considerar que el historial terminó de cargar
  const MAX_ARM_WAIT_MS = 10000; // tope por si el DOM nunca queda quieto
  const BULK_THRESHOLD = 3; // más mensajes que esto en un lote = carga de historial, no mensaje nuevo
  const TAIL_WINDOW = 3; // solo se interpretan mensajes entre los últimos N del DOM
  // Barrido de respaldo: las listas virtualizadas (Connecteam usa una) a veces
  // reciclan nodos sin disparar `childList`. Sin esto, un mensaje nuevo podría
  // no detectarse hasta el siguiente cambio real del DOM.
  const RESCAN_INTERVAL_MS = 4000;
  const SEEN_TTL_MS = 6 * 60 * 60 * 1000;
  const SEEN_STORAGE_KEY = "ke-assistant-seen";

  const log = (...a) => CONFIG.DEBUG && console.log("[KE]", ...a);

  /* ================================================================ */
  /* Estado                                                            */
  /* ================================================================ */
  let armed = false; // false mientras se carga el historial de una conversación
  let paused = false;
  let quietTimer = null;
  let armDeadline = 0;
  let lastUrl = location.href;
  const queue = [];
  let busy = false;
  const seen = loadSeen();

  function loadSeen() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SEEN_STORAGE_KEY) || "{}");
      const now = Date.now();
      return new Map(Object.entries(raw).filter(([, t]) => now - t < SEEN_TTL_MS));
    } catch {
      return new Map();
    }
  }

  function saveSeen() {
    try {
      sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Object.fromEntries(seen)));
    } catch {
      /* sin storage: la deduplicación sigue funcionando en memoria */
    }
  }

  /* ================================================================ */
  /* Extracción de datos del DOM                                        */
  /* ================================================================ */
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  /** Cascada de extracción de texto: mensaje enriquecido, texto plano, o el resto tal cual. */
  function extractText(chatMsgEl) {
    const bubble = chatMsgEl.querySelector(`${SEL.textWrapper} ${SEL.text}`) || chatMsgEl.querySelector(SEL.text);
    if (!bubble) return "";

    const clone = bubble.cloneNode(true);
    clone.querySelectorAll(SEL.replyQuote).forEach((q) => q.remove());

    const markdown = clone.querySelector(SEL.markdown);
    if (markdown) return norm(markdown.innerText);

    const plain = clone.querySelector(SEL.plainSpan);
    if (plain) return norm(plain.textContent);

    return norm(clone.innerText);
  }

  /** Id real y estable del mensaje (vive en el wrapper que lo envuelve, no en .chat-message). */
  function getMessageId(el) {
    const wrapper = el.closest(SEL.messageWrapper);
    return wrapper?.getAttribute("data-message-id") || el.getAttribute("data-id") || el.id || "";
  }

  function extract(el) {
    const text = extractText(el);
    if (!text) return null;

    const quoteEl = el.querySelector(SEL.replyQuote);
    const replyTo = quoteEl ? norm(quoteEl.innerText) : "";

    // Connecteam NO muestra .user-name-container en tus propios mensajes; en su
    // lugar marca el mensaje con la clase "me". Es más confiable que comparar
    // nombres, así que se usa para saltar tus mensajes con certeza (sin
    // necesidad de que IGNORE_AUTHORS coincida exacto con tu nombre mostrado).
    const isMe = el.classList.contains("me");

    return { id: getMessageId(el), isMe, author: isMe ? "" : findAuthor(el), text, replyTo };
  }

  /** Los mensajes consecutivos del mismo autor no repiten el nombre: se busca hacia atrás. */
  function findAuthor(el) {
    const all = Array.from(document.querySelectorAll(SEL.message));
    for (let i = all.indexOf(el); i >= 0; i--) {
      const nameEl = all[i].querySelector(SEL.author);
      if (nameEl && norm(nameEl.innerText)) return norm(nameEl.innerText);
    }
    return "";
  }

  // Normaliza acentos (p. ej. "García" === "Garcia") para que no dependa de
  // escribir la tilde exacta en IGNORE_AUTHORS.
  const foldName = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function isInternalTeam(author) {
    const a = foldName(author);
    return CONFIG.IGNORE_AUTHORS.some((n) => n && a === foldName(n));
  }

  function messageKey(el, data) {
    return data.id ? `id:${data.id}` : `tx:${data.author}|${data.replyTo}|${data.text}`;
  }

  function getChannelName() {
    const header = document.querySelector(SEL.channelTitle);
    return header ? norm(header.textContent) : "";
  }

  function isTargetChannel() {
    const nameOk = !CONFIG.CHANNEL_NAME_FRAGMENT
      || getChannelName().toLowerCase().includes(CONFIG.CHANNEL_NAME_FRAGMENT.toLowerCase());
    const urlOk = !CONFIG.CHANNEL_URL_FRAGMENT || location.href.includes(CONFIG.CHANNEL_URL_FRAGMENT);
    return nameOk && urlOk;
  }

  /* ================================================================ */
  /* Detección de mensajes nuevos (sin IA)                              */
  /* ================================================================ */
  function markAllSeen() {
    document.querySelectorAll(SEL.message).forEach((el) => {
      const data = extract(el);
      if (data) seen.set(messageKey(el, data), Date.now());
    });
    saveSeen();
  }

  /** Espera a que el DOM quede quieto; todo lo que haya en ese momento es historial. */
  function scheduleArm() {
    armed = false;
    if (!armDeadline) armDeadline = Date.now() + MAX_ARM_WAIT_MS;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      markAllSeen();
      armed = true;
      armDeadline = 0;
      setStatus(paused ? "paused" : "listening");
      log("armado");
    }, Math.max(0, Math.min(QUIET_MS, armDeadline - Date.now())));
  }

  function collectAddedMessages(mutations) {
    const found = new Set();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1 || panelHost.contains(node)) continue;
        if (node.matches(SEL.message)) found.add(node);
        node.querySelectorAll?.(SEL.message).forEach((el) => found.add(el));
        const parentMsg = node.closest?.(SEL.message);
        if (parentMsg) found.add(parentMsg); // el contenido de la burbuja llegó después
      }
    }
    return Array.from(found);
  }

  /**
   * Evalúa solo los últimos TAIL_WINDOW mensajes visibles (mensajes viejos que
   * reaparecen por scroll/virtualización nunca llegan aquí). Se llama tanto
   * desde las mutaciones reales como desde el barrido periódico de respaldo,
   * así que es segura de invocar tantas veces como haga falta: `seen` evita
   * procesar dos veces el mismo mensaje.
   */
  function evaluateTail() {
    if (paused || !isTargetChannel()) return;

    const all = Array.from(document.querySelectorAll(SEL.message));
    const tail = all.slice(-TAIL_WINDOW);

    for (const el of tail) {
      const data = extract(el);
      if (!data) continue;
      const key = messageKey(el, data);
      if (seen.has(key)) continue;
      seen.set(key, Date.now());
      saveSeen();

      if (data.isMe || isInternalTeam(data.author)) continue;

      log("mensaje nuevo", data);
      queue.push(data);
    }
    processQueue();
  }

  function onMutations(mutations) {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log("cambio de conversación");
      scheduleArm();
      return;
    }
    if (!armed) {
      scheduleArm(); // sigue cargando historial
      return;
    }

    const added = collectAddedMessages(mutations);
    if (!added.length) return;

    if (added.length > BULK_THRESHOLD) {
      log("lote grande, se trata como historial", added.length);
      markAllSeen();
      return;
    }

    evaluateTail();
  }

  /* ================================================================ */
  /* Llamada al Worker (una por mensaje nuevo)                          */
  /* ================================================================ */
  function interpret(data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.BACKEND_URL,
        headers: { "Content-Type": "application/json", "X-Shared-Secret": CONFIG.SHARED_SECRET },
        data: JSON.stringify({
          action: "interpret",
          message: data.text,
          author: data.author,
          replyTo: data.replyTo,
        }),
        timeout: 35000,
        onload: (res) => {
          let body = null;
          try {
            body = JSON.parse(res.responseText);
          } catch {
            /* se reporta abajo */
          }
          if (res.status >= 200 && res.status < 300 && body) resolve(body);
          else reject(new Error((body && body.error) || `HTTP ${res.status}`));
        },
        onerror: () => reject(new Error("No se pudo contactar al Worker")),
        ontimeout: () => reject(new Error("El Worker tardó demasiado")),
      });
    });
  }

  async function processQueue() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const data = queue.shift();
      setStatus("working");
      try {
        const result = await interpret(data);
        const card = addCard(data, result);
        if (CONFIG.AUTO_INSERT_WHEN_EMPTY) {
          const composer = findComposer();
          if (composer && composerIsEmpty(composer)) {
            insertReplyToOriginal(data, result.reply, (ok) => ok && card.markInserted());
          }
        }
      } catch (err) {
        addErrorCard(data, err.message);
      }
    }
    busy = false;
    setStatus(paused ? "paused" : "listening");
  }

  /* ================================================================ */
  /* Cuadro de texto de Connecteam — insertar es automático; enviar solo   */
  /* ocurre si tú haces clic en "Enviar" y confirmas (ver findSendButton).  */
  /* ================================================================ */
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findComposer() {
    for (const s of CONFIG.COMPOSER_SELECTORS) {
      const el = Array.from(document.querySelectorAll(s)).find(
        (e) => isVisible(e) && !panelHost.contains(e),
      );
      if (el) return el;
    }
    return null;
  }

  function composerIsEmpty(el) {
    return norm(el.isContentEditable ? el.innerText : el.value) === "";
  }

  /**
   * Busca el botón de enviar SOLO dentro de un contenedor cercano al cuadro de
   * texto — nunca en toda la página — para minimizar el riesgo de hacer clic
   * en un botón no relacionado que por casualidad coincida con el selector.
   */
  function findSendButton(composer) {
    const scope =
      composer.closest(".chat-input, form, [class*='composer' i], [class*='message-input' i]") ||
      composer.parentElement?.parentElement ||
      composer.parentElement ||
      composer;
    for (const s of CONFIG.SEND_BUTTON_SELECTORS) {
      const el = Array.from(scope.querySelectorAll(s)).find((e) => isVisible(e) && !panelHost.contains(e));
      if (el) return el;
    }
    return null;
  }

  function insertIntoComposer(el, text) {
    el.focus();
    if (el.isContentEditable) {
      // execCommand respeta el estado interno de editores React/Draft/Slate.
      if (!composerIsEmpty(el)) document.execCommand("insertText", false, " ");
      if (!document.execCommand("insertText", false, text)) {
        el.textContent += text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      setter.call(el, composerIsEmpty(el) ? text : `${el.value} ${text}`);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /**
   * Activa el "Reply" nativo de Connecteam sobre el mensaje exacto (por su id
   * estable, no por una referencia de nodo que puede haberse reciclado por la
   * lista virtualizada). Busca el botón SOLO dentro de ese mensaje, nunca en
   * toda la página. Confirmado contra el DOM real: el botón ya existe en el
   * DOM (solo oculto por CSS hasta el hover), así que un .click() directo
   * basta — no hace falta simular el hover.
   */
  function clickReply(id) {
    if (!id) return false;
    const wrapper = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!wrapper) return false; // el mensaje salió del rango virtualizado
    const btn = wrapper.querySelector(SEL.replyButton);
    if (!btn) return false;
    btn.click();
    return true;
  }

  /**
   * Rastreo de "texto pendiente nuestro": mientras el cuadro contenga EXACTO
   * lo último que insertamos (sin que Juan lo haya editado), un Enter se
   * intercepta y se redirige al mismo flujo con confirmación de "Enviar" —
   * ver el guardián de teclado más abajo. En cuanto el contenido cambia
   * (Juan lo edita o escribe algo propio), deja de aplicar y Enter vuelve a
   * comportarse nativo, como cualquier mensaje suyo normal.
   */
  let pendingAiText = "";
  let pendingAiComposer = null;

  /**
   * Inserta el texto citando el mensaje original cuando es posible. Si el
   * mensaje ya no está en el DOM (virtualización) o el botón Reply no
   * apareció, degrada sin error a una inserción normal — nunca bloquea el
   * flujo por esto.
   */
  function insertReplyToOriginal(data, text, done) {
    const finish = () => {
      const composer = findComposer();
      if (!composer) return done(false);
      insertIntoComposer(composer, text);
      // Se lee el contenido REAL después de insertar (no el "text" original):
      // si el cuadro ya tenía algo, insertIntoComposer concatena, y comparar
      // contra el texto original desarmaría el guardián de Enter por error.
      pendingAiText = norm(composer.isContentEditable ? composer.innerText : composer.value);
      pendingAiComposer = composer;
      done(true);
    };
    if (CONFIG.USE_NATIVE_REPLY && clickReply(data.id)) {
      setTimeout(finish, 200); // deja que Connecteam actualice el composer con la cita
    } else {
      finish();
    }
  }

  /**
   * Punto único de envío: confirmación nativa + clic en el botón real de
   * Connecteam. Lo usan tanto el botón "Enviar" de cada tarjeta como el
   * guardián de Enter (ver abajo) — nunca se llega aquí sin que algo
   * (un clic o un Enter sobre una sugerencia sin editar) lo dispare.
   * Devuelve: "sent" | "cancelled" | "no-composer" | "empty" | "no-send-button".
   */
  function confirmAndSend() {
    const composer = findComposer();
    if (!composer) return "no-composer";

    const current = norm(composer.isContentEditable ? composer.innerText : composer.value);
    if (!current) return "empty";

    const channel = getChannelName() || "este chat";
    if (!confirm(`¿Enviar este mensaje a "${channel}"?\n\n"${current}"`)) return "cancelled";

    const sendButton = findSendButton(composer);
    if (!sendButton) return "no-send-button";

    sendButton.click();
    pendingAiText = "";
    pendingAiComposer = null;
    return "sent";
  }

  /**
   * Guardián de Enter: si el cuadro contiene EXACTO una sugerencia nuestra sin
   * editar, intercepta Enter y lo redirige a confirmAndSend() en vez de dejar
   * que Connecteam envíe directo. Así el botón "Enviar" no es la única
   * protección — presionar Enter por reflejo nunca salta la confirmación.
   * Si Juan edita el texto (o escribe el suyo propio), esto deja de aplicar
   * automáticamente y Enter vuelve a su comportamiento nativo.
   */
  function installEnterGuard() {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || !pendingAiComposer) return;
        if (document.activeElement !== pendingAiComposer) return;
        const current = norm(
          pendingAiComposer.isContentEditable ? pendingAiComposer.innerText : pendingAiComposer.value,
        );
        if (current !== pendingAiText) {
          // Juan ya lo editó: se trata como su propio mensaje, Enter nativo.
          pendingAiText = "";
          pendingAiComposer = null;
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        confirmAndSend();
      },
      true, // capture: se adelanta al manejador nativo de Connecteam
    );

    // Si Juan edita el texto insertado, deja de tratarse como "sugerencia sin
    // confirmar" y Enter vuelve a enviar nativo, como cualquier mensaje suyo.
    document.addEventListener(
      "input",
      (e) => {
        if (e.target !== pendingAiComposer) return;
        const current = norm(
          pendingAiComposer.isContentEditable ? pendingAiComposer.innerText : pendingAiComposer.value,
        );
        if (current !== pendingAiText) {
          pendingAiText = "";
          pendingAiComposer = null;
        }
      },
      true,
    );
  }

  /* ================================================================ */
  /* Panel flotante (shadow DOM para no chocar con los estilos del sitio) */
  /* ================================================================ */
  const panelHost = document.createElement("div");
  panelHost.id = "ke-assistant-panel";
  const shadow = panelHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: fixed; right: 16px; bottom: 16px; width: 340px; max-height: 70vh;
        display: flex; flex-direction: column; z-index: 2147483647;
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328;
        background: #fff; border: 1px solid #d0d7de; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.15); }
      .wrap.min .body { display: none; }
      header { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        border-bottom: 1px solid #d0d7de; cursor: default; }
      header strong { flex: 1; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #8c959f; }
      .dot.listening { background: #1a7f37; }
      .dot.working { background: #bf8700; }
      .dot.paused { background: #8c959f; }
      .dot.error { background: #cf222e; }
      button { font: inherit; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px;
        padding: 3px 8px; cursor: pointer; color: inherit; }
      button:hover { background: #eaeef2; }
      button.primary { background: #1f6feb; color: #fff; border-color: #1f6feb; }
      button.danger { background: #cf222e; color: #fff; border-color: #cf222e; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .body { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
      .empty { color: #656d76; text-align: center; padding: 12px; }
      .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px; }
      .card.warn { border-color: #bf8700; background: #fff8c5; }
      .card.fallback { border-color: #d0d7de; background: #f6f8fa; }
      .card.err { border-color: #cf222e; background: #ffebe9; }
      .meta { color: #656d76; font-size: 12px; margin-bottom: 4px; }
      .orig { font-style: italic; margin-bottom: 6px; max-height: 4.2em; overflow: hidden; }
      textarea { width: 100%; box-sizing: border-box; min-height: 60px; font: inherit;
        border: 1px solid #d0d7de; border-radius: 6px; padding: 6px; resize: vertical; }
      .badges { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
      .badge { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #ddf4ff; }
      .badge.aviso { background: #fff1a8; }
      .badge.escalar { background: #eaeef2; }
      .badge.case { background: #e6d9ff; }
      .actions { display: flex; gap: 6px; margin-top: 6px; }
      details { margin-top: 6px; font-size: 12px; color: #656d76; }
    </style>
    <div class="wrap">
      <header>
        <span class="dot" id="dot"></span>
        <strong>KE Assistant</strong>
        <button id="testInsert" title="Pega un texto de prueba en el cuadro, sin enviarlo">Probar cuadro</button>
        <button id="pause" title="Pausar / reanudar">Pausar</button>
        <button id="min" title="Minimizar">–</button>
      </header>
      <div class="body" id="body"><div class="empty">Escuchando mensajes nuevos…</div></div>
    </div>`;

  const $ = (id) => shadow.getElementById(id);
  const cardsEl = $("body");

  $("pause").addEventListener("click", () => {
    paused = !paused;
    $("pause").textContent = paused ? "Reanudar" : "Pausar";
    setStatus(paused ? "paused" : "listening");
  });
  $("min").addEventListener("click", () => shadow.querySelector(".wrap").classList.toggle("min"));

  // Prueba aislada de inserción: no depende del backend ni de GitHub. Sirve
  // para verificar COMPOSER_SELECTORS contra el DOM real antes de que el resto
  // del pipeline esté listo. Nunca presiona Enter ni hace clic en enviar.
  $("testInsert").addEventListener("click", () => {
    const composer = findComposer();
    if (!composer) {
      $("testInsert").textContent = "No encontré el cuadro";
      setTimeout(() => ($("testInsert").textContent = "Probar cuadro"), 2500);
      return;
    }
    const testText = "Prueba de KE Assistant — puedes borrar este texto.";
    insertIntoComposer(composer, testText);
    pendingAiText = norm(composer.isContentEditable ? composer.innerText : composer.value);
    pendingAiComposer = composer;
    $("testInsert").textContent = "Insertado ✓";
    setTimeout(() => ($("testInsert").textContent = "Probar cuadro"), 2500);
  });

  function setStatus(state) {
    $("dot").className = `dot ${state}`;
    $("dot").title = state;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    children.forEach((c) => node.append(c));
    return node;
  }

  function pushCard(card) {
    cardsEl.querySelector(".empty")?.remove();
    cardsEl.prepend(card);
    while (cardsEl.children.length > 6) cardsEl.lastElementChild.remove();
  }

  function addCard(data, result) {
    const kind = !result.supported ? "fallback" : result.needsReview ? "warn" : "";
    const textarea = el("textarea", { value: result.reply });

    const badges = el("div", { className: "badges" });
    if (result.caseCategory) {
      const label = `${result.caseIsNew ? "caso nuevo" : "continúa"}: ${result.caseCategory}`;
      badges.append(el("span", { className: "badge case", textContent: label, title: result.caseId || "" }));
    }
    if (result.module) badges.append(el("span", { className: "badge", textContent: result.module }));
    if (result.autonomy) {
      const cls = result.autonomy.includes("escalar") ? "escalar" : result.autonomy.includes("aviso") ? "aviso" : "";
      badges.append(el("span", { className: `badge ${cls}`, textContent: result.autonomy }));
    }

    const insertBtn = el("button", { className: "primary", textContent: "Insertar" });
    const copyBtn = el("button", { textContent: "Copiar" });
    const dismissBtn = el("button", { textContent: "Descartar" });
    // Deshabilitado hasta que el texto quede insertado en el cuadro real —
    // así nunca se puede enviar algo que no pasó por "Insertar" primero.
    const sendBtn = el("button", {
      className: "danger",
      textContent: "Enviar",
      disabled: true,
      title: "Primero inserta el texto en el cuadro",
    });

    const card = el("div", { className: `card ${kind}` }, [
      el("div", { className: "meta", textContent: `${data.author || "Desconocido"} · ${new Date().toLocaleTimeString()}` }),
      el("div", { className: "orig", textContent: `“${data.text}”` }),
      badges,
      textarea,
      el("div", { className: "actions" }, [insertBtn, copyBtn, sendBtn, dismissBtn]),
    ]);

    if (result.reason || result.draft) {
      const details = el("details", {}, [el("summary", { textContent: "Por qué" })]);
      if (result.reason) details.append(el("div", { textContent: result.reason }));
      if (result.draft) {
        details.append(el("div", { textContent: "Borrador interno (NO insertado):" }));
        details.append(el("div", { textContent: result.draft }));
      }
      card.append(details);
    }

    insertBtn.addEventListener("click", () => {
      insertReplyToOriginal(data, textarea.value, (ok) => {
        if (!ok) {
          insertBtn.textContent = "No encontré el cuadro";
          return;
        }
        card.markInserted();
      });
    });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = "Copiado";
    });
    dismissBtn.addEventListener("click", () => card.remove());

    // Un solo clic tuyo para enviar: encuentra el botón real de Connecteam y
    // lo presiona. Requiere confirmación nativa y que el texto ya se haya
    // insertado (sendBtn empieza deshabilitado) — nunca se dispara solo.
    sendBtn.addEventListener("click", () => {
      const ok = confirmAndSend();
      if (ok === "sent") {
        sendBtn.textContent = "Enviado ✓";
        sendBtn.disabled = true;
      } else if (ok === "no-composer") {
        sendBtn.textContent = "No encontré el cuadro";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      } else if (ok === "empty") {
        sendBtn.textContent = "El cuadro está vacío";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      } else if (ok === "no-send-button") {
        sendBtn.textContent = "No encontré el botón Enviar";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      }
      // ok === "cancelled": el usuario dijo que no en el confirm(), no se toca nada.
    });

    card.markInserted = () => {
      insertBtn.textContent = "Insertado ✓ (revisa y envía tú)";
      sendBtn.disabled = false;
      sendBtn.title = "";
    };

    pushCard(card);
    return card;
  }

  function addErrorCard(data, message) {
    setStatus("error");
    pushCard(
      el("div", { className: "card err" }, [
        el("div", { className: "meta", textContent: `${data.author || "Desconocido"} · error` }),
        el("div", { className: "orig", textContent: `“${data.text}”` }),
        el("div", { textContent: message }),
      ]),
    );
  }

  /* ================================================================ */
  /* Arranque                                                          */
  /* ================================================================ */
  function start() {
    document.body.append(panelHost);
    if (/PEGA_AQUI/.test(CONFIG.SHARED_SECRET)) {
      addErrorCard({ author: "Configuración", text: "Placeholder sin reemplazar" },
        "Edita SHARED_SECRET en el userscript (Tampermonkey → Editar) para que coincida con tu backend.");
      return;
    }
    setStatus("working");
    installEnterGuard();
    new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
    scheduleArm();
    setInterval(() => armed && evaluateTail(), RESCAN_INTERVAL_MS);
  }

  start();
})();
