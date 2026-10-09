import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJobStore, handleJobAction } from "./jobs.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ke-jobs-")), "jobs.json");
const good = { card: "3968122745", parkName: "Arlington", locationId: 4809, flames: 50, amountUsd: 10, requestId: "msg-1", reason: "test_card", author: "AM Persona" };

test("crea un trabajo válido y queda pendiente", () => {
  const s = createJobStore({ file: tmp() });
  const r = s.create(good);
  assert.equal(r.ok, true);
  assert.equal(r.job.status, "pending");
});

test("rechaza tarjetas que no tienen 10 dígitos exactos", () => {
  const s = createJobStore({ file: tmp() });
  assert.equal(s.create({ ...good, card: "396812274" }).ok, false);
  assert.equal(s.create({ ...good, card: "39681227455" }).ok, false);
  assert.equal(s.create({ ...good, card: "39681227ab" }).ok, false);
});

test("respeta el tope de flames por motivo", () => {
  const s = createJobStore({ file: tmp() });
  assert.equal(s.create({ ...good, flames: 51 }).ok, false);
  assert.equal(s.create({ ...good, requestId: "m2", reason: "webhook_failed", flames: 102 }).ok, true);
});

test("rechaza un requestId repetido (anti doble recarga)", () => {
  const s = createJobStore({ file: tmp() });
  assert.equal(s.create(good).ok, true);
  const again = s.create(good);
  assert.equal(again.ok, false);
  assert.match(again.error, /duplicad/i);
});

test("next entrega el pendiente y lo marca como ofrecido", () => {
  const s = createJobStore({ file: tmp() });
  s.create(good);
  const job = s.next();
  assert.equal(job.status, "offered");
  assert.equal(s.next(), null);
});

test("un trabajo cargado bloquea otro igual (tarjeta + flames) dentro del TTL", () => {
  let t = 1_000_000;
  const s = createJobStore({ file: tmp(), now: () => t, ttlMs: 1000 });
  const { job } = s.create(good);
  s.next();
  s.complete(job.id, "done", "Fila verificada");
  assert.equal(s.create({ ...good, requestId: "otro" }).ok, false);
  t += 2000; // pasó el TTL
  assert.equal(s.create({ ...good, requestId: "otro" }).ok, true);
});

test("persiste en disco y se recarga", () => {
  const file = tmp();
  createJobStore({ file }).create(good);
  assert.equal(createJobStore({ file }).list().length, 1);
});

test("handleJobAction expone create / next / result / list", () => {
  const s = createJobStore({ file: tmp() });
  const c = handleJobAction(s, { action: "job_create", job: good });
  assert.equal(c.ok, true);
  const n = handleJobAction(s, { action: "job_next" });
  assert.equal(n.job.id, c.job.id);
  const r = handleJobAction(s, { action: "job_result", id: c.job.id, status: "submitted", detail: "Credit pulsado por Juan" });
  assert.equal(r.ok, true);
  assert.equal(handleJobAction(s, { action: "job_list" }).jobs[0].status, "submitted");
  assert.equal(handleJobAction(s, { action: "job_result", id: c.job.id, status: "inventado" }).ok, false);
});
