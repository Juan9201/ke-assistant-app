import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTicketStore, statusFromAnalysis } from "./tickets.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ke-tk-")), "tickets.json");
const msg = (over = {}) => ({ caseId: "c1", messageKey: "k1", messageId: "m1", author: "AM Rashel Carswell", text: "play card not loading flames", images: [], ts: 1000, ...over });

test("crea un ticket numerado por orden de llegada y lo encuentra por su caseId", () => {
  const s = createTicketStore({ file: tmp() });
  const a = s.create(msg());
  const b = s.create(msg({ caseId: "c2", messageKey: "k2", author: "M Otra Persona" }));
  assert.deepEqual([a.number, b.number], [1, 2]);
  assert.equal(a.id, "T0001");
  assert.equal(s.findByCase("c2").id, "T0002");
  assert.deepEqual(s.list().map((t) => t.number), [1, 2]);
});

test("persiste en disco: al reiniciar el servidor los tickets siguen y la numeración continúa", () => {
  const file = tmp();
  const s1 = createTicketStore({ file });
  s1.create(msg());
  s1.setAnalysis("T0001", { protocol: "receipt", reply: "q", replyKind: "question" });
  const s2 = createTicketStore({ file });
  assert.equal(s2.size(), 1);
  assert.equal(s2.get("T0001").status, "waiting_staff");
  assert.equal(s2.create(msg({ caseId: "c9", messageKey: "k9", author: "otro" })).number, 2);
});

test("hilo: el mismo autor, con el ticket esperando al staff, suma su respuesta al MISMO ticket", () => {
  let t = 0;
  const s = createTicketStore({ file: tmp(), now: () => t });
  const tk = s.create(msg());
  s.setAnalysis(tk.id, { reply: "May I know in which park...", replyKind: "question" });
  t = 5 * 60 * 1000;
  const r = s.resolve({ caseId: "c-nuevo", author: "AM Rashel Carswell" });
  assert.equal(r.ticket.id, tk.id);
  assert.equal(r.continued, true);
  s.appendMessage(tk.id, msg({ caseId: "c-nuevo", messageKey: "k-nuevo", text: "arlington" }), "c-nuevo");
  assert.equal(s.combinedText(s.get(tk.id)), "play card not loading flames\narlington");
  assert.equal(s.canonicalCase("c-nuevo"), "c1", "el alias apunta al caseId canónico");
  assert.equal(s.findByCase("c-nuevo").id, tk.id);
});

test("hilo: no se suma a un ticket de otra persona, ni a uno vencido, ni a uno ya cerrado", () => {
  let t = 0;
  const s = createTicketStore({ file: tmp(), now: () => t, continueWindowMs: 1000 });
  const tk = s.create(msg());
  s.setAnalysis(tk.id, { reply: "q", replyKind: "question" });
  assert.equal(s.resolve({ caseId: "x", author: "AM Otra Persona" }), null, "otra persona");
  t = 2000;
  assert.equal(s.resolve({ caseId: "x", author: "AM Rashel Carswell" }), null, "ticket vencido");
  t = 500;
  s.setStatus(tk.id, "resolved");
  assert.equal(s.resolve({ caseId: "x", author: "AM Rashel Carswell" }), null, "ticket cerrado");
});

test("el autor se compara sin acentos, mayúsculas ni espacios de más", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg({ author: "AM José  Pérez" }));
  s.setAnalysis(tk.id, { reply: "q", replyKind: "question" });
  assert.equal(s.resolve({ caseId: "z", author: "am jose perez" }).ticket.id, tk.id);
});

test("reenviar el mismo mensaje no lo duplica, pero sí suma fotos que no se habían visto", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg());
  s.appendMessage(tk.id, msg());
  s.appendMessage(tk.id, msg({ images: ["https://cdn.example.com/a.jpg"] }));
  assert.equal(s.get(tk.id).messages.length, 1);
  assert.deepEqual(s.get(tk.id).messages[0].images, ["https://cdn.example.com/a.jpg"]);
});

test("solo se guardan URLs http(s) de fotos, y no más de 6", () => {
  const s = createTicketStore({ file: tmp() });
  const imgs = ["https://a/1.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "http://b/2.jpg", ...Array.from({ length: 10 }, (_, i) => `https://c/${i}.jpg`)];
  const tk = s.create(msg({ images: imgs }));
  assert.equal(tk.messages[0].images.length, 6);
  assert.ok(tk.messages[0].images.every((u) => /^https?:\/\//.test(u)));
});

test("estado derivado del análisis: escalado, rectificar, esperando, listo", () => {
  assert.equal(statusFromAnalysis({ protocol: "out_of_scope" }), "escalated");
  assert.equal(statusFromAnalysis({ protocol: "receipt", verdict: "escalate" }), "escalated");
  assert.equal(statusFromAnalysis({ protocol: "receipt", verdict: "B" }), "needs_rectification");
  assert.equal(statusFromAnalysis({ protocol: "receipt", reply: "q", replyKind: "question" }), "waiting_staff");
  assert.equal(statusFromAnalysis({ protocol: "receipt", verdict: "A", dataReady: true }), "ready_for_approval");
  assert.equal(statusFromAnalysis(null), "new");
});

test("un estado fijado por una persona no lo cambia el análisis; se puede reabrir", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg());
  s.setStatus(tk.id, "denied");
  s.setAnalysis(tk.id, { protocol: "receipt", verdict: "A", dataReady: true });
  assert.equal(s.get(tk.id).status, "denied");
  s.reopen(tk.id);
  assert.equal(s.get(tk.id).status, "ready_for_approval");
  assert.equal(s.setStatus(tk.id, "inventado"), null);
});

test("las correcciones solo aceptan campos permitidos y un valor vacío las quita", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg());
  s.mergeOverrides(tk.id, { card: "3968122745", receiptNumber: "19402005", admin: true, flames: 50 });
  assert.deepEqual(s.get(tk.id).overrides, { card: "3968122745", receiptNumber: "19402005", flames: 50 });
  s.mergeOverrides(tk.id, { card: "" });
  assert.equal(s.get(tk.id).overrides.card, undefined);
});

test("el hilo y el borrador se guardan, y 'lastInserted' recuerda lo último insertado en Connecteam", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg());
  s.addThread(tk.id, { role: "juan", kind: "inserted", text: "Hello Rashel, ..." });
  s.setDraft(tk.id, "borrador");
  s.setLastInserted(tk.id, "Hello Rashel, ...");
  const g = s.get(tk.id);
  assert.equal(g.thread[0].kind, "inserted");
  assert.equal(g.draft, "borrador");
  assert.equal(g.lastInserted, "Hello Rashel, ...");
});

test("el resumen de la lista trae lo necesario sin cargar todo el ticket", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg({ images: ["https://a/1.jpg"] }));
  s.setAnalysis(tk.id, { protocol: "receipt", verdict: "A", dataReady: true, fields: { parkCode: "TX-Arlington", receiptNumber: "19402005" } });
  const r = s.list()[0];
  assert.equal(r.parkCode, "TX-Arlington");
  assert.equal(r.receiptNumber, "19402005");
  assert.equal(r.hasImages, true);
  assert.equal(r.status, "ready_for_approval");
  assert.ok(!("messages" in r && Array.isArray(r.messages)), "no incluye los mensajes completos");
});

test("un archivo dañado no tumba el servidor: arranca vacío", () => {
  const file = tmp();
  fs.writeFileSync(file, "{ esto no es json");
  const s = createTicketStore({ file });
  assert.equal(s.size(), 0);
  assert.equal(s.create(msg()).number, 1);
});

test("el mismo mensaje con el texto editado reemplaza al anterior (no se duplica)", () => {
  const s = createTicketStore({ file: tmp() });
  const tk = s.create(msg({ text: "texto viejo" }));
  const nuevo = msg({ text: "texto nuevo" });
  assert.equal(s.combinedText(s.get(tk.id), nuevo), "texto nuevo");
  s.appendMessage(tk.id, nuevo);
  assert.equal(s.get(tk.id).messages.length, 1);
  assert.equal(s.get(tk.id).messages[0].text, "texto nuevo");
});
