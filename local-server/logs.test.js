import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLog, loadLogs, redact, EVENT_KINDS } from "./logs.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ke-log-"));
}

function readLines(dir) {
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".jsonl"));
  return fs
    .readFileSync(path.join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("CA-01: un log escribe un evento por línea y una línea de cierre con outcome", () => {
  const dir = tmpDir();
  const t = createLog({ caseId: "c1", author: "AM Persona" }, { dir });
  t.add("input", "Mensaje recibido", "hola", { text: "hola" });
  t.add("thought", "Entiendo que...", "es un tema de play card");
  t.end("asked_missing_data", "Faltaba el Receipt ID");
  const lines = readLines(dir);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.kind), ["input", "thought", "end"]);
  assert.equal(lines[2].outcome, "asked_missing_data");
  assert.ok(lines.every((l) => l.caseId === "c1"));
  assert.ok(lines.every((l) => typeof l.ts === "string"));
});

test("CA-02: los secretos se redactan, anidados también", () => {
  const out = redact({ apiKey: "sk-123", nested: { Authorization: "Bearer x", ok: 1 }, list: [{ password: "p" }] });
  assert.equal(out.apiKey, "[REDACTADO]");
  assert.equal(out.nested.Authorization, "[REDACTADO]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.list[0].password, "[REDACTADO]");

  const dir = tmpDir();
  const t = createLog({ caseId: "c2" }, { dir });
  t.add("action", "Llamada", "", { system: "gravity", token: "abc", card: "1064928789" });
  t.end("answered");
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8");
  assert.ok(!raw.includes("abc"));
  assert.ok(raw.includes("1064928789")); // los datos del caso sí se conservan (carpeta local fuera de git)
});

test("CA-04: un tipo de evento desconocido se rechaza", () => {
  const t = createLog({ caseId: "c3" }, { dir: tmpDir() });
  assert.throws(() => t.add("inventado", "x"), /tipo de evento/i);
  assert.ok(EVENT_KINDS.includes("thought"));
});

test("un outcome inválido se rechaza", () => {
  const t = createLog({ caseId: "c4" }, { dir: tmpDir() });
  assert.throws(() => t.end("quizas"), /outcome/i);
});

test("no se puede agregar eventos después de cerrar", () => {
  const t = createLog({ caseId: "c5" }, { dir: tmpDir() });
  t.end("escalated");
  assert.throws(() => t.add("input", "tarde"), /cerrad/i);
});

test("CA-07: una acción fuera de Connecteam/Gravity/Amusement se rechaza", () => {
  const t = createLog({ caseId: "c6" }, { dir: tmpDir() });
  assert.throws(() => t.add("action", "Buscar", "", { system: "google", query: "x" }), /alcance|sistema/i);
  assert.throws(() => t.add("action", "Buscar", "", { query: "x" }), /sistema/i);
  t.add("action", "Buscar en el chat", "scroll en la lista de mensajes", { system: "connecteam", where: "chat Gravity Support", query: "AM John Eason" });
});

test("los pasos registran índice, total y estado, y validan sus datos", () => {
  const dir = tmpDir();
  const t = createLog({ caseId: "p1" }, { dir });
  t.step(1, 3, "Buscar el mensaje", "start");
  t.step(1, 3, "Buscar el mensaje", "done");
  t.step(2, 3, "Validar tarjeta", "fail", "9 dígitos");
  const lines = readLines(dir);
  assert.deepEqual(lines.map((l) => l.kind), ["step", "step", "step"]);
  assert.deepEqual(lines[0].data, { index: 1, total: 3, state: "start" });
  assert.equal(lines[2].data.state, "fail");
  assert.equal(lines[2].detail, "9 dígitos");
  assert.throws(() => t.step(0, 3, "x", "start"), /paso/i);
  assert.throws(() => t.step(4, 3, "x", "start"), /paso/i);
  assert.throws(() => t.step(1, 3, "x", "raro"), /estado/i);
});

test("spec 001 R-02 / R-05: acepta los tipos 'vision' y 'approval' y los resultados 'executed' y 'denied'", () => {
  const dir = tmpDir();
  const t = createLog({ caseId: "k1" }, { dir });
  t.add("vision", "Lectura de la foto", "Receipt Number #19402005", { confidence: 0.99 });
  t.add("approval", "Juan negó el pedido");
  t.end("denied", "negado");
  const t2 = createLog({ caseId: "k2" }, { dir });
  t2.end("executed");
});

test("los eventos de un caso se ordenan por hora aunque el servidor se haya reiniciado (seq vuelve a 0)", () => {
  const dir = tmpDir();
  createLog({ caseId: "r1" }, { dir }).add("input", "primero");
  createLog({ caseId: "r1" }, { dir }).add("approval", "después");
  const c = loadLogs(dir).find((x) => x.id === "r1");
  assert.deepEqual(c.events.map((e) => e.title), ["primero", "después"]);
});

import { loadCaseEvents } from "./logs.js";

test("loadCaseEvents trae solo los eventos del caso pedido (y de sus alias), en orden", () => {
  const dir = tmpDir();
  createLog({ caseId: "a1" }, { dir }).add("input", "uno");
  createLog({ caseId: "b2" }, { dir }).add("input", "otro caso");
  const t = createLog({ caseId: "a1-alias" }, { dir });
  t.add("reply", "dos");
  const ev = loadCaseEvents(["a1", "a1-alias"], dir);
  assert.deepEqual(ev.map((e) => e.title), ["uno", "dos"]);
  assert.deepEqual(loadCaseEvents("nada", dir), []);
  assert.deepEqual(loadCaseEvents("", dir), []);
});
