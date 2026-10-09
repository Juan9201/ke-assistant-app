import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFlowLogger } from "./flowlog.js";
import { loadLogs } from "./logs.js";
import { analyzeFlameRequest } from "./flamerequest.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ke-flow-"));
const analyze = (text, extra = {}) => analyzeFlameRequest({ text, author: "AM Rashel Carswell", greetingName: "Rashel", ...extra });

test("un pedido nuevo registra mensaje, protocolo, datos, validación y pregunta", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  const text = "Playcard not loading flames at Chandler";
  f.onAnalysis({ caseId: "msg-1", text, author: "AM Rashel Carswell" }, analyze(text));
  const kinds = loadLogs(dir)[0].events.map((e) => e.kind);
  assert.deepEqual(kinds, ["input", "match", "extract", "check", "reply"]);
});

test("corregir campos agrega un evento y no repite el mensaje", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  const text = "Playcard not loading flames at Chandler";
  f.onAnalysis({ caseId: "msg-2", text, author: "AM R" }, analyze(text));
  f.onAnalysis({ caseId: "msg-2", text, author: "AM R", edited: true }, analyze(text, { overrides: { card: "0800450398", receiptNumber: "19402005" } }));
  const events = loadLogs(dir)[0].events;
  assert.equal(events.filter((e) => e.kind === "input").length, 1);
  assert.ok(events.some((e) => e.title.includes("corrigió")));
});

test("aprobar o negar queda registrado y cierra el caso", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  const text = "test card 3968122745 at Arlington";
  f.onAnalysis({ caseId: "msg-3", text, author: "AM R" }, analyze(text));
  f.onPanelEvent({ caseId: "msg-3", kind: "approval", title: "Juan negó el pedido", outcome: "denied" });
  const events = loadLogs(dir)[0].events;
  assert.equal(events.at(-2).kind, "approval");
  assert.equal(events.at(-1).outcome, "denied");
});

test("un caso fuera de alcance se escala y se cierra solo", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  const text = "the card is bent and won't scan";
  f.onAnalysis({ caseId: "msg-4", text, author: "AM R" }, analyze(text));
  const events = loadLogs(dir)[0].events;
  assert.ok(events.some((e) => e.kind === "escalation"));
  assert.equal(events.at(-1).outcome, "escalated");
});

test("un mensaje que no es de flames no genera log", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  f.onAnalysis({ caseId: "msg-5", text: "Where can I buy a gift?", author: "x" }, analyze("Where can I buy a gift?"));
  assert.equal(loadLogs(dir).length, 0);
});

test("el panel no puede registrar acciones en sistemas ni resultados raros", () => {
  const f = createFlowLogger({ dir: tmp() });
  assert.throws(() => f.onPanelEvent({ caseId: "x", kind: "action", title: "t" }), /no permitido/);
  assert.throws(() => f.onPanelEvent({ caseId: "x", kind: "approval", title: "t", outcome: "escalated" }), /no permitido/);
  assert.throws(() => f.onPanelEvent({ kind: "approval", title: "t" }), /caseId/);
});

test("los secretos no entran a los logs", () => {
  const dir = tmp();
  const f = createFlowLogger({ dir });
  f.onPanelEvent({ caseId: "s1", kind: "error", title: "t", data: { apiKey: "SECRETO-123" } });
  assert.ok(!fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8").includes("SECRETO-123"));
});
