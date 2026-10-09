import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTicketStore } from "./tickets.js";
import { createCommandStore } from "./commands.js";
import { createLookupStore } from "./lookups.js";
import { createTicketOps } from "./ticketops.js";
import { normalizeGravity } from "./gravity.js";

function setup(over = {}) {
  const calls = [];
  const log = {
    onAnalysis: (...a) => calls.push(["analysis", ...a]),
    onPanelEvent: (e) => calls.push(["panel", e]),
    onLookupRequested: (...a) => calls.push(["lookup", ...a]),
  };
  const tickets = createTicketStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ke-ops-")), "t.json") });
  const commands = createCommandStore();
  const lookups = createLookupStore();
  const state = { gravity: null, vision: null };
  const ops = createTicketOps({
    tickets, commands, lookups, log,
    greetingNameFor: (a) => String(a).replace(/^(AM|M|C|RTM|\*)\s+/, "").split(" ")[0],
    gravityFor: () => state.gravity,
    visionFor: () => state.vision,
    ...over,
  });
  return { ops, tickets, commands, lookups, calls, state };
}

const msg = (over = {}) => ({ caseId: "c1", messageKey: "k1", messageId: "m1", author: "AM Rashel Carswell", text: "Playcard not loading flames at Chandler, receipt 19400001", images: [], ...over });
const G = (over = {}) => normalizeGravity({
  found: true, transactionId: 19400001, venueId: 194, venueName: "AZ-Chandler", date: "2026-10-09T10:00:00", deviceName: "CHANDLER POS 1", total: 21, status: 6, type: 1,
  products: [{ name: "Play Card", qty: 1, price: 1, gpCardType: 0 }, { name: "$20 = 102 flames", qty: 1, price: 20, gpCardType: 5 }],
  gpCards: [{ code: "2222222222", gpCardType: 5 }], payments: [{ type: "Credit Payment", amount: 21 }], ...over,
});

test("un pedido de flames crea un ticket, queda en los logs y pide la lectura a Gravity por su cuenta", () => {
  const { ops, calls, lookups } = setup();
  const r = ops.analyzeMessage(msg());
  assert.equal(r.created, true);
  assert.equal(r.ticket.number, 1);
  assert.equal(r.analysis.protocol, "receipt");
  assert.ok(calls.some((c) => c[0] === "analysis"));
  assert.ok(calls.some((c) => c[0] === "lookup"), "se pidió la lectura");
  assert.equal(lookups.next("gravity").params.receiptNumber, "19400001");
});

test("un mensaje que no es de flames no crea ticket", () => {
  const { ops, tickets } = setup();
  const r = ops.analyzeMessage(msg({ text: "Where can I buy a gift card?" }));
  assert.equal(r.ticket, null);
  assert.equal(r.analysis.isFlameRequest, false);
  assert.equal(tickets.size(), 0);
});

test("hilo: la respuesta del staff ('arlington') completa el MISMO ticket y el análisis usa todo", () => {
  const { ops, tickets } = setup();
  const a = ops.analyzeMessage(msg({ text: "Playcard not loading flames, card 3968122745", caseId: "c1" }));
  assert.equal(a.analysis.missing.includes("park"), true);
  assert.equal(a.ticket.status, "waiting_staff");
  const b = ops.analyzeMessage(msg({ caseId: "c2", messageKey: "k2", messageId: "m2", text: "arlington, receipt 19400001" }));
  assert.equal(b.continued, true);
  assert.equal(b.ticket.id, a.ticket.id);
  assert.equal(tickets.size(), 1);
  assert.equal(b.analysis.fields.parkCode, "TX-Arlington");
  assert.equal(b.ticket.messages.length, 2);
  assert.equal(b.ticket.caseId, "c1", "el caseId canónico es el del primer mensaje");
});

test("hilo: un mensaje largo y ajeno del mismo staff no se suma a un ticket que espera su respuesta", () => {
  const { ops, tickets } = setup();
  ops.analyzeMessage(msg({ text: "Playcard not loading flames, card 3968122745" }));
  const r = ops.analyzeMessage(msg({ caseId: "c9", messageKey: "k9", text: "also we need to know about the schedule for the next birthday party reservations next weekend please send details" }));
  assert.equal(r.continued, false);
  assert.equal(tickets.size(), 1, "no es de flames: no abre otro ticket");
  assert.equal(tickets.get("T0001").messages.length, 1);
});

test("re-evaluar el mismo mensaje (caseId conocido) no duplica el mensaje ni el log", () => {
  const { ops, calls, tickets } = setup();
  ops.analyzeMessage(msg());
  const antes = calls.filter((c) => c[0] === "analysis").length;
  ops.analyzeMessage(msg());
  assert.equal(tickets.get("T0001").messages.length, 1);
  assert.equal(calls.filter((c) => c[0] === "analysis").length, antes, "sin cambios no se vuelve a registrar");
});

test("lo que se corrige en el widget (overrides) queda en el ticket y lo ve la consola", () => {
  const { ops, tickets } = setup();
  ops.analyzeMessage(msg());
  const r = ops.analyzeMessage(msg({ overrides: { card: "3968122745" } }));
  assert.equal(tickets.get("T0001").overrides.card, "3968122745");
  assert.equal(r.analysis.fields.card, "3968122745");
});

test("la lectura de Gravity se pide una sola vez en 60 s, aunque se re-evalúe", () => {
  let t = 0;
  const { ops, lookups } = setup({ now: () => t });
  ops.analyzeMessage(msg());
  ops.refresh("T0001");
  ops.refresh("T0001");
  assert.equal(lookups.next("gravity") !== null, true);
  assert.equal(lookups.next("gravity"), null, "no se duplicó");
});

test("refresh: con la lectura de Gravity el ticket pasa a caso A y a 'listo'", () => {
  const { ops, state } = setup();
  ops.analyzeMessage(msg({ text: "Playcard not loading flames at Chandler, card 2222222222, receipt 19400001" }));
  state.gravity = { ...G(), requestedReceipt: "19400001" };
  const t = ops.refresh("T0001");
  assert.equal(t.analysis.verdict, "A");
  assert.equal(t.status, "ready_for_approval");
  assert.equal(t.analysis.fields.flames, 102);
});

test("refresh: con otra tarjeta en el chat el ticket pasa a 'rectificar' (caso B)", () => {
  const { ops, state } = setup();
  ops.analyzeMessage(msg({ text: "Playcard not loading flames at Chandler, card 3333333333, receipt 19400001" }));
  state.gravity = { ...G(), requestedReceipt: "19400001" };
  assert.equal(ops.refresh("T0001").status, "needs_rectification");
});

test("responder: insertar crea un comando que cita el último mensaje del staff, y NO envía", () => {
  const { ops, commands } = setup();
  ops.analyzeMessage(msg({ messageId: "msg-77" }));
  const r = ops.reply({ ticketId: "T0001", text: "Hello Rashel, May I know in which park are you located, please?", mode: "insert" });
  assert.equal(r.ok, true);
  const cmd = commands.next("connecteam");
  assert.equal(cmd.type, "insert_reply");
  assert.equal(cmd.params.messageId, "msg-77");
  assert.match(cmd.params.snippet, /Playcard not loading/);
});

test("responder: enviar exige haber insertado exactamente ese texto", () => {
  const { ops, commands } = setup();
  ops.analyzeMessage(msg());
  const texto = "Hello Rashel, thanks!";
  assert.equal(ops.reply({ ticketId: "T0001", text: texto, mode: "send" }).ok, false, "sin insertar no se envía");
  const ins = ops.reply({ ticketId: "T0001", text: texto, mode: "insert" });
  const cmd = commands.next("connecteam");
  assert.equal(ops.commandResult({ id: cmd.id, ok: true }).ok, true);
  assert.equal(ops.reply({ ticketId: "T0001", text: "otro texto", mode: "send" }).ok, false, "texto distinto al insertado");
  const send = ops.reply({ ticketId: "T0001", text: texto, mode: "send" });
  assert.equal(send.ok, true);
  assert.equal(commands.next("connecteam").type, "send_reply");
  assert.ok(ins.command);
});

test("resultado de un comando: queda en el hilo y en los logs; si falla, se explica", () => {
  const { ops, commands, tickets, calls } = setup();
  ops.analyzeMessage(msg());
  ops.reply({ ticketId: "T0001", text: "Hello Rashel, ok", mode: "insert" });
  const c1 = commands.next("connecteam");
  ops.commandResult({ id: c1.id, ok: true });
  assert.equal(tickets.get("T0001").thread.at(-1).kind, "inserted");
  assert.equal(tickets.get("T0001").lastInserted, "Hello Rashel, ok");
  ops.reply({ ticketId: "T0001", text: "Hello Rashel, otra", mode: "insert" });
  const c2 = commands.next("connecteam");
  ops.commandResult({ id: c2.id, ok: false, error: "No encontré el cuadro de texto" });
  assert.match(tickets.get("T0001").thread.at(-1).text, /No se pudo insertar.*cuadro de texto/);
  assert.ok(calls.some((c) => c[0] === "panel" && c[1].kind === "error"));
  assert.ok(calls.some((c) => c[0] === "panel" && /insertada en Connecteam/.test(c[1].title)));
});

test("enviar con éxito limpia lo insertado y lo deja en el hilo", () => {
  const { ops, commands, tickets } = setup();
  ops.analyzeMessage(msg());
  ops.reply({ ticketId: "T0001", text: "Hello Rashel, ok", mode: "insert" });
  ops.commandResult({ id: commands.next("connecteam").id, ok: true });
  ops.reply({ ticketId: "T0001", text: "Hello Rashel, ok", mode: "send" });
  ops.commandResult({ id: commands.next("connecteam").id, ok: true });
  assert.equal(tickets.get("T0001").thread.at(-1).kind, "sent");
  assert.equal(tickets.get("T0001").lastInserted, null);
});

test("aprobar solo se puede cuando el análisis lo permite (las mismas condiciones del botón verde)", () => {
  const { ops } = setup();
  ops.analyzeMessage(msg());
  const r = ops.act({ ticketId: "T0001", action: "approve" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Todavía no se puede aprobar/);
});

test("negar, resolver y reabrir; todo queda en los logs", () => {
  const { ops, tickets, calls } = setup();
  ops.analyzeMessage(msg());
  assert.equal(ops.act({ ticketId: "T0001", action: "deny" }).ticket.status, "denied");
  assert.ok(calls.some((c) => c[0] === "panel" && c[1].outcome === "denied"));
  assert.equal(ops.act({ ticketId: "T0001", action: "resolve" }).ticket.status, "resolved");
  assert.notEqual(ops.act({ ticketId: "T0001", action: "reopen" }).ticket.status, "resolved");
  assert.equal(ops.act({ ticketId: "T0001", action: "borrar" }).ok, false);
  assert.equal(ops.act({ ticketId: "T9999", action: "deny" }).ok, false);
  assert.ok(tickets.get("T0001"));
});

test("corregir desde la consola re-evalúa el ticket", () => {
  const { ops } = setup();
  ops.analyzeMessage(msg({ text: "Playcard not loading flames at Chandler" }));
  const r = ops.reanalyze({ ticketId: "T0001", overrides: { card: "3968122745", receiptNumber: "19400001" } });
  assert.equal(r.ok, true);
  assert.equal(r.ticket.analysis.fields.card, "3968122745");
  assert.equal(r.ticket.analysis.fields.receiptNumber, "19400001");
  assert.equal(ops.reanalyze({ ticketId: "nada", overrides: {} }).ok, false);
});

test("un fallo al escribir el log nunca tumba la operación", () => {
  const { ops } = setup({ log: { onAnalysis() { throw new Error("disco lleno"); }, onPanelEvent() { throw new Error("disco lleno"); }, onLookupRequested() { throw new Error("disco lleno"); } } });
  const orig = console.error;
  console.error = () => {};
  try {
    const r = ops.analyzeMessage(msg());
    assert.equal(r.ticket.number, 1);
    assert.equal(ops.act({ ticketId: "T0001", action: "deny" }).ok, true);
  } finally {
    console.error = orig;
  }
});

test("si el listener no pudo citar el mensaje, la inserción vale pero queda el aviso en el hilo", () => {
  const { ops, commands, tickets } = setup();
  ops.analyzeMessage(msg());
  ops.reply({ ticketId: "T0001", text: "Hello Rashel, ok", mode: "insert" });
  ops.commandResult({ id: commands.next("connecteam").id, ok: true, note: "No encontré el mensaje del staff en pantalla: la respuesta se insertó sin citarlo." });
  const th = tickets.get("T0001").thread;
  assert.equal(th.at(-1).kind, "inserted");
  assert.match(th.find((x) => x.kind === "info").text, /sin citarlo/);
});
