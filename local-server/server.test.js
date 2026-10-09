/**
 * Prueba de humo del servidor real: arranca server.js en un puerto aleatorio con un secreto de prueba
 * y recorre sus rutas. Atrapa errores que `node --check` no ve (imports faltantes, regex mal escapadas).
 * No escribe logs reales: no manda caseId.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET = "secreto-de-prueba";
const PORT = 20000 + Math.floor(Math.random() * 20000);
let child;

function request({ method = "GET", p = "/", host, body, secret = SECRET }) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host || `127.0.0.1:${PORT}` };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["X-Shared-Secret"] = secret;
    }
    const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  child = spawn(process.execPath, ["server.js"], { cwd: HERE, env: { ...process.env, PORT: String(PORT), SHARED_SECRET: SECRET, KE_LOGS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "ke-srv-logs-")) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("el servidor no arrancó")), 8000);
    child.stdout.on("data", (d) => /escuchando/.test(String(d)) && (clearTimeout(t), resolve()));
    child.stderr.on("data", (d) => (clearTimeout(t), reject(new Error(String(d)))));
  });
});
after(() => child?.kill());

test("GET /health responde", async () => {
  assert.equal((await request({ p: "/health" })).status, 200);
});

test("el userscript se sirve con la versión y las URLs de actualización; un Host externo recibe 403", async () => {
  const r = await request({ p: "/userscript/connecteam-listener-v2.user.js" });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /javascript/);
  assert.match(r.body, /@version\s+\d+\.\d+\.\d+/);
  assert.match(r.body, /@updateURL\s+http:\/\/127\.0\.0\.1:8787\/userscript\/connecteam-listener-v2\.user\.js/);
  assert.equal((await request({ p: "/userscript/connecteam-listener-v2.user.js", host: "evil.example.com" })).status, 403);
});

test("la versión del userscript coincide entre la cabecera y SCRIPT_VERSION", async () => {
  const js = (await request({ p: "/userscript/connecteam-listener-v2.user.js" })).body;
  const header = js.match(/@version\s+(\S+)/)[1];
  const inCode = js.match(/SCRIPT_VERSION = "([^"]+)"/)[1];
  assert.equal(header, inCode);
});

test("/logs sirve la página, /api/logs los datos, sin CORS; /traces ya no existe", async () => {
  const page = await request({ p: "/logs" });
  assert.equal(page.status, 200);
  const api = await request({ p: "/api/logs" });
  assert.equal(api.status, 200);
  assert.equal(api.headers["access-control-allow-origin"], undefined);
  assert.equal((await request({ p: "/api/logs", host: "evil.example.com" })).status, 403);
  assert.notEqual((await request({ p: "/traces" })).status, 200);
});

test("sin secreto o con secreto incorrecto: 401", async () => {
  assert.equal((await request({ method: "POST", p: "/", body: { action: "list_parks" }, secret: "otro" })).status, 401);
});

test("analyze_flames devuelve contrato, protocolo y parque del directorio (caso real de Zarak)", async () => {
  const r = await request({
    method: "POST",
    body: { action: "analyze_flames", author: "Zarak Lutfi", text: "Hello kids empire Westchase I loaded a card with 50 flames but the card doesn't seem to be working the number will be 2585468226" },
  });
  const a = JSON.parse(r.body);
  assert.equal(r.status, 200);
  assert.equal(a.contract, 2);
  assert.equal(a.protocol, "receipt");
  assert.equal(a.fields.parkCode, "TX-Houston Westchase");
  assert.match(a.reply, /^Hello Zarak, /);
});

test("analyze_flames: un rango con * se quita del saludo", async () => {
  const r = await request({ method: "POST", body: { action: "analyze_flames", author: "* paquito contreras", text: "Playcard not loading flames" } });
  assert.match(JSON.parse(r.body).reply, /^Hello paquito, /);
});

test("list_parks entrega los 127 parques", async () => {
  const r = JSON.parse((await request({ method: "POST", body: { action: "list_parks" } })).body);
  assert.equal(r.parks.length, 127);
  assert.ok(r.parks.some((p) => p.code === "TX-Houston Westchase"));
});

test("log_event rechaza acciones en sistemas desde el panel", async () => {
  const r = await request({ method: "POST", body: { action: "log_event", caseId: "x", kind: "action", title: "t" } });
  assert.equal(r.status, 400);
});

test("read_image rechaza tipos no permitidos, imágenes vacías y casos sin id", async () => {
  assert.equal((await request({ method: "POST", body: { action: "read_image", caseId: "c", mime: "application/pdf", imageBase64: "AAAA" } })).status, 400);
  assert.equal((await request({ method: "POST", body: { action: "read_image", caseId: "c", mime: "image/jpeg", imageBase64: "" } })).status, 400);
  assert.equal((await request({ method: "POST", body: { action: "read_image", mime: "image/jpeg", imageBase64: "AAAA" } })).status, 400);
});

const PHOTO = path.join(HERE, "..", "IMG Training", "05.jpg");
const PHOTO3 = path.join(HERE, "..", "IMG Training", "03.jpg");

test("foto real: read_image lee el ticket y analyze_flames del mismo caso ya trae el recibo y el parque", { skip: !fs.existsSync(PHOTO3) && "no hay foto de prueba" }, async () => {
  const caseId = `prueba-vision-${Date.now()}`;
  const r = await request({ method: "POST", body: { action: "read_image", caseId, mime: "image/jpeg", imageBase64: fs.readFileSync(PHOTO3).toString("base64") } });
  if (r.status === 502) return; // sin Python/RapidOCR en este PC: no es un fallo del código
  assert.equal(r.status, 200);
  const v = JSON.parse(r.body);
  assert.equal(v.facts.receiptNumber, "19396510");
  assert.ok(v.findings.some((f) => f.kind === "receipt_number" && f.box.length === 4));
  const a = JSON.parse((await request({ method: "POST", body: { action: "analyze_flames", caseId, author: "AM Rashel Carswell", text: "play card 3968122745 has no flames" } })).body);
  assert.equal(a.fields.receiptNumber, "19396510");
  assert.equal(a.fields.receiptSource, "foto");
  assert.equal(a.fields.parkCode, "GA-Marietta");
  assert.equal(a.fields.flames, 204);
  assert.equal(a.reply, null);
});

/* ---------- Consultas de solo lectura a Gravity (T-07) ---------- */
const post = async (body) => {
  const r = await request({ method: "POST", body });
  return { status: r.status, json: r.body ? JSON.parse(r.body) : null };
};

test("el lector de Gravity se sirve con el secreto inyectado por el servidor; un Host externo recibe 403", async () => {
  const r = await request({ p: "/userscript/gravity-reader.user.js" });
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes("__SHARED_SECRET__"), "el marcador se reemplazó");
  assert.ok(r.body.includes(SECRET), "lleva el secreto de este servidor");
  assert.match(r.body, /@match\s+https:\/\/access\.thegravityapp\.io\/\*/);
  assert.equal((await request({ p: "/userscript/gravity-reader.user.js", host: "evil.example.com" })).status, 403);
  assert.equal((await request({ p: "/userscript/otro.user.js" })).status, 405, "solo los archivos de la lista");
});

test("lookup: valida lo que se pide y solo entrega consultas al lector del sistema correcto", async () => {
  assert.equal((await post({ action: "lookup_create", system: "google", kind: "transaction", params: {} })).status, 400);
  assert.equal((await post({ action: "lookup_create", system: "gravity", kind: "transaction", params: { receiptNumber: "abc" } })).status, 400);
  const c = await post({ action: "lookup_create", caseId: "prueba-lk-0", system: "gravity", kind: "transaction", params: { receiptNumber: "19400000" } });
  assert.equal(c.status, 200);
  assert.equal((await post({ action: "lookup_next", system: "amusement" })).json.job, null);
  assert.equal((await post({ action: "lookup_next", system: "gravity" })).json.job.id, c.json.job.id);
  await post({ action: "lookup_result", id: c.json.job.id, ok: false, error: "sin sesión" });
});

test("ciclo completo: el panel pide, el lector responde (con datos personales que se filtran) y el análisis trae el veredicto A", async () => {
  const caseId = "prueba-lk-1";
  const c = await post({ action: "lookup_create", caseId, system: "gravity", kind: "transaction", params: { receiptNumber: "19400001" } });
  const job = (await post({ action: "lookup_next", system: "gravity" })).json.job;
  assert.equal(job.id, c.json.job.id);
  const sucio = {
    found: true, transactionId: 19400001, venueId: 22, venueName: "TX-Houston Westchase", date: "2026-10-09T13:21:17.217", deviceName: "WESTCHASE POS 3",
    total: 21, status: 6, type: 1, note: "", customerName: "Persona Real", email: "persona@real.com",
    products: [{ name: "Play Card", qty: 1, price: 1, gpCardType: 0 }, { name: "$20 = 102 flames", qty: 1, price: 20, gpCardType: 5, customerName: "Persona Real" }],
    gpCards: [{ code: "2222222222", originalBalance: 20, remainingBalance: 0, gpCardType: 5, recipientName: "Persona Real" }],
    payments: [{ type: "Credit Payment", amount: 21, cardNumber: "4111111111111111" }],
  };
  assert.equal((await post({ action: "lookup_result", id: job.id, ok: true, data: sucio })).status, 200);
  assert.equal((await post({ action: "lookup_status", id: job.id })).json.status, "done");

  const a = (await post({ action: "analyze_flames", caseId, author: "AM Rashel Carswell", text: "Hello kids empire Westchase, the play card 2222222222 did not load the flames, receipt #19400001" })).json;
  assert.equal(a.verdict, "A");
  assert.equal(a.fields.flames, 102);
  assert.equal(a.fields.locationId, 1063);
  assert.ok(a.evidence.length >= 5);
  assert.ok(!JSON.stringify(a).includes("Persona Real") && !JSON.stringify(a).includes("4111111111111111"));

  // Otra tarjeta en el chat → caso B con la respuesta literal
  const b = (await post({ action: "analyze_flames", caseId, author: "AM Rashel Carswell", text: "Hello kids empire Westchase, the play card 3333333333 did not load the flames, receipt #19400001" })).json;
  assert.equal(b.verdict, "B");
  assert.match(b.reply, /play card and receipt info doesn't match/);

  // Si el Receipt Number cambia, la lectura guardada ya no vale
  const otro = (await post({ action: "analyze_flames", caseId, author: "AM Rashel Carswell", text: "Hello kids empire Westchase, the play card 2222222222 did not load the flames, receipt #19400009" })).json;
  assert.equal(otro.verdict, "pending");
  assert.equal(otro.evidence.length, 0);
});

test("lookup_result: el servidor vuelve a filtrar aunque el lector mande de más", async () => {
  const caseId = "prueba-lk-2";
  const c = await post({ action: "lookup_create", caseId, system: "gravity", kind: "transaction", params: { receiptNumber: "19400003" } });
  const job = (await post({ action: "lookup_next", system: "gravity" })).json.job;
  await post({ action: "lookup_result", id: job.id, ok: true, data: { found: true, transactionId: 19400003, venueId: 22, venueName: "X", date: "2026-10-09T10:00:00", deviceName: "P", total: 5, status: 6, products: [], gpCards: [], payments: [], email: "persona@real.com", adultCustomers: [{ name: "Persona Real" }] } });
  const a = (await post({ action: "analyze_flames", caseId, author: "AM R", text: "play card 2222222222 flames receipt #19400003 at Westchase" })).json;
  assert.ok(!JSON.stringify(a).includes("persona@real.com"));
  assert.equal((await post({ action: "lookup_status", id: c.json.job.id })).json.status, "done");
});

test("el listener se entrega con el secreto inyectado por el servidor (el archivo del repo solo trae el marcador)", async () => {
  const r = await request({ p: "/userscript/connecteam-listener-v2.user.js" });
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes("__SHARED_SECRET__"), "el marcador se reemplazó");
  assert.ok(r.body.includes(`SHARED_SECRET: "${SECRET}"`));
  const enRepo = fs.readFileSync(path.join(HERE, "..", "userscript", "connecteam-listener-v2.user.js"), "utf8");
  assert.ok(enRepo.includes('SHARED_SECRET: "__SHARED_SECRET__"'), "el archivo del repo lleva el marcador");
});
