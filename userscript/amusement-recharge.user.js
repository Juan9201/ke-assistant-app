// ==UserScript==
// @name         KE Assistant — Recarga en Manual Kiosk (con aprobación)
// @namespace    https://github.com/Juan9201/ke-assistant-app
// @version      0.1.0
// @description  Toma un trabajo de recarga del servidor local, prepara el Manual Kiosk y deja el botón "Aprobar y cargar". Solo una persona puede pulsarlo.
// @match        https://app.amusementconnect.com/ManualKiosk/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==
//
// PROTOTIPO — SIN PROBAR EN VIVO. Corre en tu Chrome ya autenticado: no usa ni guarda credenciales.
// Regla de oro: el clic en "Credit" (#submit2) solo ocurre dentro del manejador del botón
// "Aprobar y cargar", y solo si el evento es de una persona (event.isTrusted).

(function () {
  "use strict";

  const CONFIG = {
    BACKEND_URL: "http://localhost:8787",
    SHARED_SECRET: "PEGA_AQUI_EL_MISMO_SHARED_SECRET_DEL_BACKEND",
    POLL_MS: 3000,
    AMOUNT_ATTEMPTS: 3, // el JS del formulario a veces calcula mal la primera vez
  };
  const KEY = "ke-recharge-job";

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* ------------------------------ servidor local ------------------------------ */
  function api(body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.BACKEND_URL,
        headers: { "Content-Type": "application/json", "X-Shared-Secret": CONFIG.SHARED_SECRET },
        data: JSON.stringify(body),
        timeout: 15000,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error(`HTTP ${r.status}`)); }
        },
        onerror: () => reject(new Error("Sin conexión con el servidor local")),
        ontimeout: () => reject(new Error("El servidor tardó demasiado")),
      });
    });
  }

  /* ----------------------------------- panel ----------------------------------- */
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .wrap{position:fixed;right:16px;bottom:16px;width:330px;z-index:2147483647;font:13px/1.4 system-ui,Segoe UI,sans-serif;
        background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
      header{padding:8px 10px;border-bottom:1px solid #d0d7de;font-weight:600}
      .body{padding:10px;display:flex;flex-direction:column;gap:6px}
      .job{background:#f6f8fa;border-radius:6px;padding:6px 8px;font-size:12px}
      .ok{color:#1a7f37}.bad{color:#cf222e}
      button{font:inherit;border:1px solid #d0d7de;border-radius:6px;padding:5px 10px;cursor:pointer;background:#f6f8fa}
      button.go{background:#cf222e;border-color:#cf222e;color:#fff}
      button:disabled{opacity:.45;cursor:not-allowed}
    </style>
    <div class="wrap"><header>KE Assistant — Recarga</header>
      <div class="body"><div id="status">Esperando trabajo…</div><div class="job" id="job" hidden></div>
        <div style="display:flex;gap:6px"><button class="go" id="approve" disabled>Aprobar y cargar</button><button id="discard" disabled>Descartar</button></div>
      </div></div>`;
  const g = (id) => shadow.getElementById(id);
  const say = (msg, cls = "") => { g("status").textContent = msg; g("status").className = cls; };

  /* ----------------------------------- estado ---------------------------------- */
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } };
  const store = (s) => (s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY));
  let state = load(); // { job, step, visits }

  function showJob(job) {
    g("job").hidden = false;
    g("job").textContent = `Tarjeta ${job.card} · ${job.parkName} · ${job.flames} flames ($${job.amountUsd}) · ${job.reason} · pide: ${job.author || "—"}`;
    g("discard").disabled = false;
  }

  async function fail(msg) {
    say(msg, "bad");
    g("approve").disabled = true;
    if (state?.job) { try { await api({ action: "job_result", id: state.job.id, status: "failed", detail: msg }); } catch { /* sin red */ } }
    store(null);
    state = null;
  }

  /* ------------------------------ preparar pantalla ----------------------------- */
  function currentLocationId() { return Number(new URL(location.href).searchParams.get("locationId")); }
  function kioskTitle() {
    const el = [...document.querySelectorAll("input[type=text]")].find((i) => /manual kiosk/i.test(i.value));
    return el ? norm(el.value) : "";
  }
  function creditsReadout() {
    const box = $("#createcardwithcredits") || document;
    const el = [...box.querySelectorAll("input")].find((i) => i.id !== "dollarAmount" && (i.readOnly || i.disabled));
    return el ? parseFloat(el.value) : NaN;
  }
  async function typeAmount(text) {
    const input = $("#dollarAmount");
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of String(text)) {
      input.value += ch;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true })); // dispara onkeyup → ChangeCredits
      await sleep(120);
    }
    await sleep(400);
  }

  async function prepare() {
    const { job } = state;
    showJob(job);

    // 1) Parque correcto. La URL con locationId lo preselecciona; si no coincide, se navega una vez.
    if (currentLocationId() !== job.locationId) {
      state.visits = (state.visits || 0) + 1;
      if (state.visits > 1) return fail(`No pude abrir el parque ${job.parkName} (locationId ${job.locationId}).`);
      store(state);
      say(`Abriendo el Manual Kiosk de ${job.parkName}…`);
      const u = new URL(location.href);
      u.searchParams.set("locationId", String(job.locationId));
      location.href = u.toString();
      return;
    }
    const title = kioskTitle();
    if (!title.toLowerCase().includes(job.parkName.toLowerCase())) {
      return fail(`El kiosk abierto dice "${title}", no ${job.parkName}. No se prepara nada.`);
    }

    // 2) Reload Card + tarjeta.
    $("#RechargeCard").click();
    const area = $("#rfidCardId");
    area.focus();
    area.value = job.card;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));

    // 3) Monto tecleado; se reescribe hasta que los créditos cuadren con los flames pedidos.
    for (let i = 1; i <= CONFIG.AMOUNT_ATTEMPTS; i++) {
      say(`Escribiendo el monto $${job.amountUsd} (intento ${i}/${CONFIG.AMOUNT_ATTEMPTS})…`);
      await typeAmount(job.amountUsd);
      if (creditsReadout() === job.flames) break;
    }
    const shown = creditsReadout();
    if (shown !== job.flames) return fail(`Los créditos no cuadran: la pantalla muestra ${shown} y se esperaban ${job.flames}. No se carga.`);

    state.step = "ready";
    store(state);
    say(`Listo: ${job.flames} flames para ${job.card} en ${job.parkName}. Revisa y aprueba.`, "ok");
    g("approve").disabled = false;
  }

  /* ----------------------------- aprobación humana ------------------------------ */
  g("approve").addEventListener("click", async (ev) => {
    if (!ev.isTrusted) return; // un script no puede aprobar por una persona
    const job = state?.job;
    if (!job || state.step !== "ready") return;
    // Se revalidan los datos de la pantalla justo antes del clic.
    if ($("#rfidCardId").value.trim() !== job.card || creditsReadout() !== job.flames) return fail("La pantalla cambió; no se carga.");
    if (!confirm(`¿Cargar ${job.flames} flames a la tarjeta ${job.card} en ${job.parkName}?`)) return;
    g("approve").disabled = true;
    state.step = "submitted";
    store(state);
    await api({ action: "job_result", id: job.id, status: "submitted", detail: "Aprobado y enviado por una persona" }).catch(() => {});
    say("Enviado. Verifica la fila nueva en cardScanReports.", "ok");
    $("#submit2").click(); // el formulario se envía; la página se recarga
  });

  g("discard").addEventListener("click", async () => {
    if (state?.job) await api({ action: "job_result", id: state.job.id, status: "rejected", detail: "Descartado por una persona" }).catch(() => {});
    store(null); state = null;
    g("job").hidden = true; g("approve").disabled = true; g("discard").disabled = true;
    say("Descartado. Esperando trabajo…");
  });

  /* ----------------------------------- bucle ------------------------------------ */
  async function poll() {
    if (state) return;
    try {
      const r = await api({ action: "job_next" });
      if (r.job) { state = { job: r.job, step: "preparing", visits: 0 }; store(state); prepare().catch((e) => fail(e.message)); }
    } catch (e) { say(e.message, "bad"); }
  }

  function start() {
    document.body.append(host);
    if (/PEGA_AQUI/.test(CONFIG.SHARED_SECRET)) return say("Falta SHARED_SECRET en el userscript.", "bad");
    if (state?.step === "submitted") { say("Se envió la carga. Verifica en cardScanReports.", "ok"); store(null); state = null; }
    else if (state?.job) prepare().catch((e) => fail(e.message));
    setInterval(poll, CONFIG.POLL_MS);
  }
  start();
})();
