import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookupStore } from "./lookups.js";

const gravity = (over = {}) => ({ system: "gravity", kind: "transaction", params: { receiptNumber: "19420186" }, caseId: "c1", ...over });

test("crea, entrega al lector del sistema correcto y completa", () => {
  const s = createLookupStore();
  const { job } = s.create(gravity());
  assert.equal(job.status, "pending");
  assert.equal(s.next("amusement"), null, "otro sistema no ve esta consulta");
  const taken = s.next("gravity");
  assert.equal(taken.id, job.id);
  assert.equal(s.next("gravity"), null, "ya fue tomada");
  assert.equal(s.complete(job.id, { ok: true, data: { found: true } }).ok, true);
  assert.deepEqual(s.get(job.id).result, { found: true });
  assert.equal(s.get(job.id).status, "done");
});

test("valida sistema, tipo de consulta y parámetros", () => {
  const s = createLookupStore();
  assert.equal(s.create(gravity({ system: "google" })).ok, false);
  assert.equal(s.create(gravity({ kind: "refund" })).ok, false);
  assert.equal(s.create(gravity({ params: { receiptNumber: "12" } })).ok, false);
  assert.equal(s.create(gravity({ params: { receiptNumber: "1942018x" } })).ok, false);
  assert.equal(s.create({ system: "amusement", kind: "card_history", params: { card: "123", locationId: 1 } }).ok, false);
  assert.equal(s.create({ system: "amusement", kind: "card_history", params: { card: "1234567890", locationId: 2364 } }).ok, true);
});

test("la misma consulta del mismo caso se reutiliza en vez de duplicarse", () => {
  const s = createLookupStore();
  const a = s.create(gravity());
  const b = s.create(gravity());
  assert.equal(b.reused, true);
  assert.equal(b.job.id, a.job.id);
  assert.notEqual(s.create(gravity({ caseId: "otro" })).job.id, a.job.id, "otro caso, otra consulta");
});

test("las consultas atendidas en orden de llegada", () => {
  const s = createLookupStore();
  const a = s.create(gravity({ params: { receiptNumber: "19400001" } }));
  const b = s.create(gravity({ params: { receiptNumber: "19400002" } }));
  assert.equal(s.next("gravity").id, a.job.id);
  assert.equal(s.next("gravity").id, b.job.id);
});

test("una consulta que nadie toma caduca; una tomada que no se completa también", () => {
  let t = 0;
  const s = createLookupStore({ now: () => t, pendingTtlMs: 1000, takenTtlMs: 500 });
  const a = s.create(gravity({ params: { receiptNumber: "19400001" } })).job;
  t = 1500;
  assert.equal(s.get(a.id).status, "expired");
  assert.equal(s.next("gravity"), null);
  const b = s.create(gravity({ params: { receiptNumber: "19400002" } })).job;
  s.next("gravity");
  t = 2100;
  assert.equal(s.get(b.id).status, "expired", "el lector se cayó a mitad");
  assert.equal(s.complete(b.id, { ok: true, data: {} }).ok, false, "no se completa una consulta caducada");
});

test("un error del lector se guarda con su mensaje", () => {
  const s = createLookupStore();
  const j = s.create(gravity()).job;
  s.next("gravity");
  s.complete(j.id, { ok: false, error: "sesión caducada" });
  const g = s.get(j.id);
  assert.equal(g.status, "error");
  assert.equal(g.error, "sesión caducada");
  assert.equal(g.result, null);
});

test("el almacén no crece sin límite", () => {
  const s = createLookupStore({ max: 5 });
  for (let i = 0; i < 20; i++) s.create(gravity({ params: { receiptNumber: String(19400000 + i) } }));
  assert.ok(s.size() <= 5);
});
