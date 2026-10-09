/**
 * Prueba del lector de Gravity en un entorno simulado (sin navegador): fetch falso con la forma REAL de la API
 * (incluyendo datos personales a propósito) y un servidor local falso. Comprueba que solo salen campos operativos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "userscript", "gravity-reader.user.js"), "utf8");

/** Ejecuta el lector con un fetch y un servidor falsos; devuelve lo que habría enviado al servidor. */
async function runReader({ fetchImpl, job }) {
  const posted = [];
  const timers = [];
  const el = () => ({ style: {}, append() {}, textContent: "" });
  const sandbox = {
    console,
    document: { createElement: el, body: { append() {} } },
    setInterval: (fn) => timers.push(fn),
    setTimeout: (fn) => fn(), // sin esperas reales
    fetch: fetchImpl,
    encodeURIComponent,
    GM_xmlhttpRequest: (o) => {
      const body = JSON.parse(o.data);
      posted.push(body);
      const reply = body.action === "lookup_next" ? { job } : { ok: true };
      queueMicrotask(() => o.onload({ status: 200, responseText: JSON.stringify(reply) }));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  for (let i = 0; i < 40 && !posted.some((p) => p.action === "lookup_result"); i++) await new Promise((r) => setImmediate(r));
  return posted;
}

const API = (id, over = {}) => ({
  card: null,
  transactionComplete: {
    transactionId: id,
    cashier: "caja@kidsempire.us",
    adultCustomers: [{ name: "Persona Real", phone: "5551234567", email: "persona@real.com" }],
    minorCustomers: [{ name: "Menor Real" }],
    venue: { id: 22, name: "TX-Houston Westchase", manager: "Gerente Real", phone: "5559999999", venueEmail: "park@kidsempire.us" },
    originalTransaction: {
      id, venueId: 22, transactionDate: "2026-10-09T13:21:17.217", deviceName: "WESTCHASE POS 3", total: 21, transactionStatus: 6, transactionType: 1, transactionNote: "",
      cashier: "caja@kidsempire.us",
      products: [{ varietyName: "$20 = 102 flames", quantity: 1, price: 20, gpCardType: 5, customerName: "Persona Real" }],
      gpCards: [{ code: "2222222222", originalBalance: 20, remainingBalance: 0, gpCardType: 5, recipientName: "Persona Real", email: "persona@real.com", phoneNumber: "5551234567" }],
      payments: [{ description: "Credit Payment", amount: 21, cardNumber: "4111111111111111", response: "APPROVED" }],
      ...over,
    },
  },
});
const ok = (body) => async () => ({ status: 200, ok: true, json: async () => body });
const jobFor = (n) => ({ id: "lk-1", system: "gravity", kind: "transaction", params: { receiptNumber: String(n) } });
const result = (posted) => posted.find((p) => p.action === "lookup_result");

test("el lector pide una consulta, lee el recibo y devuelve solo campos operativos", async () => {
  const posted = await runReader({ fetchImpl: ok(API(19400001)), job: jobFor(19400001) });
  assert.equal(posted[0].action, "lookup_next");
  assert.equal(posted[0].system, "gravity");
  const r = result(posted);
  assert.equal(r.ok, true);
  assert.equal(r.id, "lk-1");
  assert.equal(r.data.found, true);
  assert.equal(r.data.venueId, 22);
  assert.equal(r.data.products[0].name, "$20 = 102 flames");
  assert.equal(r.data.gpCards[0].code, "2222222222");
  assert.equal(r.data.payments[0].type, "Credit Payment");
  const enviado = JSON.stringify(posted);
  for (const secreto of ["Persona Real", "Menor Real", "persona@real.com", "5551234567", "caja@kidsempire.us", "Gerente Real", "4111111111111111", "APPROVED", "park@kidsempire.us"]) {
    assert.ok(!enviado.includes(secreto), `se filtró: ${secreto}`);
  }
});

test("solo usa GET a la API de Gravity (nunca escribe)", async () => {
  const llamadas = [];
  await runReader({ fetchImpl: async (url, init) => (llamadas.push({ url, init }), { status: 200, ok: true, json: async () => API(19400001) }), job: jobFor(19400001) });
  assert.ok(llamadas.length >= 1);
  for (const c of llamadas) {
    assert.match(c.url, /^\/api\/CheckOut\/transactionDetail\/19400001\/maskCardNumber\/false\/true$/);
    assert.ok(!c.init.method || c.init.method === "GET");
    assert.equal(c.init.credentials, "same-origin");
  }
});

test("un número que no existe (Gravity responde 500) se reporta como no encontrado, tras un reintento", async () => {
  let n = 0;
  const posted = await runReader({ fetchImpl: async () => (n++, { status: 500, ok: false, json: async () => ({}) }), job: jobFor(99999999) });
  assert.equal(n, 2, "un reintento");
  assert.equal(result(posted).data.found, false);
});

test("si el número corresponde a otra cosa (p. ej. una tarjeta regalo con datos personales), no se lee nada", async () => {
  const otra = { card: { recipientName: "Persona Real", email: "persona@real.com", code: ";9757775284771?" }, transactionComplete: null };
  const posted = await runReader({ fetchImpl: ok(otra), job: jobFor(100000) });
  const r = result(posted);
  assert.equal(r.data.found, false);
  assert.equal(r.data.reason, "not_a_transaction");
  assert.ok(!JSON.stringify(posted).includes("persona@real.com"));
});

test("si la transacción devuelta no es la pedida, no se acepta", async () => {
  const posted = await runReader({ fetchImpl: ok(API(19400002)), job: jobFor(19400001) });
  assert.equal(result(posted).data.found, false);
});

test("sesión caducada: se informa el error, no se inventa un resultado", async () => {
  const posted = await runReader({ fetchImpl: async () => ({ status: 401, ok: false, json: async () => ({}) }), job: jobFor(19400001) });
  const r = result(posted);
  assert.equal(r.ok, false);
  assert.match(r.error, /sesión de Gravity caducó/);
});

test("sin consultas pendientes no hace nada más que preguntar", async () => {
  const posted = await runReader({ fetchImpl: ok(API(1)), job: null });
  assert.equal(posted.filter((p) => p.action === "lookup_result").length, 0);
});

test("el archivo no lleva secretos; solo el marcador que el servidor reemplaza", () => {
  assert.ok(SRC.includes("__SHARED_SECRET__"));
  assert.ok(!/SHARED_SECRET:\s*"[0-9a-f-]{20,}"/.test(SRC));
});
