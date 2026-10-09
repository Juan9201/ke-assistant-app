import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandStore } from "./commands.js";

const ins = (over = {}) => ({ type: "insert_reply", params: { ticketId: "T0001", text: "Hello Rashel, May I know in which park are you located, please?", messageId: "m1", snippet: "play card not loading", ...over } });

test("crea un comando, lo entrega al ejecutor de Connecteam una sola vez y lo completa", () => {
  const s = createCommandStore();
  const { command } = s.create(ins());
  assert.equal(command.status, "pending");
  assert.equal(command.ticketId, "T0001");
  const taken = s.next("connecteam");
  assert.equal(taken.id, command.id);
  assert.equal(s.next("connecteam"), null, "ya fue tomado");
  assert.equal(s.complete(command.id, { ok: true }).ok, true);
  assert.equal(s.get(command.id).status, "done");
});

test("valida destino, tipo y parámetros (nada de texto vacío ni demasiado largo)", () => {
  const s = createCommandStore();
  assert.equal(s.create({ ...ins(), target: "gravity" }).ok, false);
  assert.equal(s.create({ ...ins(), type: "delete_ticket" }).ok, false);
  assert.equal(s.create(ins({ text: "   " })).ok, false);
  assert.equal(s.create(ins({ text: "x".repeat(2001) })).ok, false);
  assert.equal(s.create(ins({ ticketId: "" })).ok, false);
  assert.equal(s.create({ type: "insert_reply" }).ok, false);
  assert.equal(s.create(ins({ messageId: 42 })).ok, false);
});

test("limpia los parámetros: recorta el texto y los largos", () => {
  const s = createCommandStore();
  const { command } = s.create(ins({ text: "  hola  ", messageId: "m".repeat(500), snippet: "s".repeat(500) }));
  assert.equal(command.params.text, "hola");
  assert.equal(command.params.messageId.length, 120);
  assert.equal(command.params.snippet.length, 200);
});

test("un comando que nadie toma caduca, y uno tomado que no se completa también", () => {
  let t = 0;
  const s = createCommandStore({ now: () => t, pendingTtlMs: 1000, takenTtlMs: 500 });
  const a = s.create(ins()).command;
  t = 1500;
  assert.equal(s.get(a.id).status, "expired");
  assert.equal(s.next("connecteam"), null);
  const b = s.create(ins({ ticketId: "T0002" })).command;
  s.next("connecteam");
  t = 2100;
  assert.equal(s.get(b.id).status, "expired");
  assert.equal(s.complete(b.id, { ok: true }).ok, false, "no se completa uno caducado");
});

test("un fallo guarda el motivo", () => {
  const s = createCommandStore();
  const c = s.create(ins()).command;
  s.next("connecteam");
  s.complete(c.id, { ok: false, error: "No encontré el cuadro de texto" });
  assert.equal(s.get(c.id).status, "failed");
  assert.match(s.get(c.id).error, /cuadro de texto/);
});

test("send_reply también exige ticket y texto", () => {
  const s = createCommandStore();
  assert.equal(s.create({ type: "send_reply", params: { ticketId: "T1", text: "x" } }).ok, true);
  assert.equal(s.create({ type: "send_reply", params: { ticketId: "T1" } }).ok, false);
});

test("los comandos van en orden de llegada", () => {
  const s = createCommandStore();
  const a = s.create(ins({ ticketId: "T1" })).command;
  const b = s.create(ins({ ticketId: "T2" })).command;
  assert.equal(s.next("connecteam").id, a.id);
  assert.equal(s.next("connecteam").id, b.id);
});

test("el almacén no crece sin límite", () => {
  const s = createCommandStore({ max: 5 });
  for (let i = 0; i < 20; i++) s.create(ins({ ticketId: `T${i}` }));
  assert.ok(s.size() <= 5);
});
