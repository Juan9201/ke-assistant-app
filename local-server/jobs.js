/**
 * Cola de trabajos de recarga (prototipo).
 *
 * El backend NUNCA mueve valor: solo guarda "trabajos" que el userscript del Manual Kiosk
 * (corriendo en el Chrome de Juan, con su sesión) toma, prepara en pantalla y deja a un
 * clic de "Aprobar y cargar". Aquí viven las guardas por código: tarjeta de 10 dígitos,
 * tope de flames por motivo, y anti doble recarga (requestId y tarjeta+flames dentro del TTL).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "jobs.json");

export const REASONS = ["test_card", "webhook_failed"];
export const CAPS = { test_card: 50, webhook_failed: 250 };
const RESULT_STATUSES = ["submitted", "done", "failed", "rejected"];
const OPEN = ["pending", "offered", "submitted", "done"]; // estados que cuentan para el anti-duplicado

export function createJobStore({ file = DEFAULT_FILE, now = () => Date.now(), ttlMs = 7 * 24 * 3600 * 1000 } = {}) {
  let jobs = [];
  try {
    jobs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    jobs = [];
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
  };

  function validate(j) {
    if (!j || typeof j !== "object") return "Falta el trabajo";
    if (typeof j.card !== "string" || !/^\d{10}$/.test(j.card)) return "La tarjeta debe tener exactamente 10 dígitos";
    if (!REASONS.includes(j.reason)) return `Motivo inválido (usa ${REASONS.join(" o ")})`;
    if (!Number.isInteger(j.flames) || j.flames < 1) return "Los flames deben ser un entero positivo";
    if (j.flames > CAPS[j.reason]) return `Supera el tope de ${CAPS[j.reason]} flames para ${j.reason}`;
    if (typeof j.amountUsd !== "number" || !(j.amountUsd > 0) || j.amountUsd > 999) return "Monto en dólares inválido (0 a 999)";
    if (typeof j.parkName !== "string" || !j.parkName.trim()) return "Falta el nombre del parque";
    if (!Number.isInteger(j.locationId)) return "Falta el locationId del parque";
    if (typeof j.requestId !== "string" || !j.requestId.trim()) return "Falta el requestId (id del mensaje de origen)";
    return null;
  }

  return {
    create(input) {
      const err = validate(input);
      if (err) return { ok: false, error: err };
      const t = now();
      const dup = jobs.find(
        (x) =>
          OPEN.includes(x.status) &&
          (x.requestId === input.requestId ||
            (x.card === input.card && x.flames === input.flames && x.status !== "pending" && t - x.createdAt < ttlMs)),
      );
      if (dup) return { ok: false, error: `Trabajo duplicado (ya existe ${dup.id}, estado ${dup.status})` };
      const job = {
        id: crypto.randomUUID(),
        status: "pending",
        createdAt: t,
        card: input.card,
        parkName: input.parkName.trim(),
        locationId: input.locationId,
        flames: input.flames,
        amountUsd: input.amountUsd,
        requestId: input.requestId.trim(),
        reason: input.reason,
        author: typeof input.author === "string" ? input.author.slice(0, 120) : "",
      };
      jobs.push(job);
      save();
      return { ok: true, job };
    },
    next() {
      const job = jobs.find((j) => j.status === "pending");
      if (!job) return null;
      job.status = "offered";
      job.offeredAt = now();
      save();
      return job;
    },
    complete(id, status, detail = "") {
      const job = jobs.find((j) => j.id === id);
      if (!job) return { ok: false, error: "Trabajo no encontrado" };
      if (!RESULT_STATUSES.includes(status)) return { ok: false, error: `Estado inválido: ${status}` };
      job.status = status;
      job.detail = String(detail).slice(0, 300);
      job.updatedAt = now();
      save();
      return { ok: true, job };
    },
    list() {
      return jobs.slice();
    },
  };
}

/** Acciones HTTP (las llama server.js, ya autenticadas con X-Shared-Secret). */
export function handleJobAction(store, body) {
  switch (body.action) {
    case "job_create":
      return store.create(body.job);
    case "job_next":
      return { ok: true, job: store.next() };
    case "job_result":
      return store.complete(body.id, body.status, body.detail);
    case "job_list":
      return { ok: true, jobs: store.list() };
    default:
      return { ok: false, error: `Acción desconocida: ${body.action}` };
  }
}
