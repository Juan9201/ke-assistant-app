/**
 * Cola de consultas de solo lectura (spec 002, T-07/T-08).
 *
 * El servidor NO tiene tu sesión de Gravity ni de Amusement: solo tu Chrome la tiene. Por eso las consultas
 * viven aquí como "trabajos": el panel de Connecteam pide una, un lector (userscript) que corre dentro de la
 * pestaña de Gravity o de Amusement la toma, hace la lectura con tu sesión y devuelve el resultado.
 * Todo es R0 (lectura): ninguna consulta modifica datos.
 */

import crypto from "node:crypto";

export const SYSTEMS = ["gravity", "amusement"];
export const KINDS = {
  gravity: ["transaction"], // detalle de un recibo por su número
  amusement: ["card_history"], // historial de una tarjeta
};

const PARAM_RULES = {
  "gravity:transaction": (p) => (/^\d{6,9}$/.test(String(p.receiptNumber)) ? null : "receiptNumber debe tener entre 6 y 9 dígitos"),
  "amusement:card_history": (p) =>
    /^\d{10}$/.test(String(p.card)) && Number.isInteger(p.locationId) ? null : "card (10 dígitos) y locationId (entero) son obligatorios",
};

export function createLookupStore({ now = () => Date.now(), pendingTtlMs = 90_000, takenTtlMs = 60_000, dedupeMs = 120_000, max = 500 } = {}) {
  const jobs = new Map();
  let seq = 0;

  const expire = () => {
    const t = now();
    for (const j of jobs.values()) {
      if (j.status === "pending" && t - j.createdAt > pendingTtlMs) j.status = "expired";
      else if (j.status === "taken" && t - j.takenAt > takenTtlMs) j.status = "expired";
    }
  };
  const view = (j) => ({ id: j.id, system: j.system, kind: j.kind, params: j.params, caseId: j.caseId, status: j.status, createdAt: j.createdAt });

  return {
    create({ system, kind, params = {}, caseId = "" } = {}) {
      if (!SYSTEMS.includes(system)) return { ok: false, error: `Sistema no permitido: ${system}` };
      if (!KINDS[system].includes(kind)) return { ok: false, error: `Consulta no permitida: ${system}/${kind}` };
      const bad = PARAM_RULES[`${system}:${kind}`](params);
      if (bad) return { ok: false, error: bad };
      expire();
      const key = JSON.stringify([system, kind, params]);
      const t = now();
      // La misma consulta pedida otra vez (p. ej. al editar un campo) reutiliza la vigente en vez de duplicarla.
      for (const j of jobs.values()) {
        if (j.key === key && j.caseId === String(caseId) && ["pending", "taken", "done"].includes(j.status) && t - j.createdAt < dedupeMs) return { ok: true, job: view(j), reused: true };
      }
      const job = { id: `lk-${++seq}-${crypto.randomBytes(3).toString("hex")}`, key, system, kind, params, caseId: String(caseId), status: "pending", createdAt: t, result: null };
      jobs.set(job.id, job);
      while (jobs.size > max) jobs.delete(jobs.keys().next().value);
      return { ok: true, job: view(job), reused: false };
    },
    /** Lo llama el lector de ese sistema: toma la consulta pendiente más antigua. */
    next(system) {
      expire();
      for (const j of jobs.values()) {
        if (j.system === system && j.status === "pending") {
          j.status = "taken";
          j.takenAt = now();
          return view(j);
        }
      }
      return null;
    },
    complete(id, { ok = true, data = null, error = "" } = {}) {
      const j = jobs.get(id);
      if (!j) return { ok: false, error: "Consulta no encontrada" };
      if (j.status !== "taken") return { ok: false, error: `La consulta está en estado ${j.status}` };
      j.status = ok ? "done" : "error";
      j.result = ok ? data : null;
      j.error = ok ? "" : String(error).slice(0, 300);
      j.doneAt = now();
      return { ok: true, job: view(j) };
    },
    get(id) {
      expire();
      const j = jobs.get(id);
      return j ? { ...view(j), result: j.result, error: j.error || "" } : null;
    },
    size: () => jobs.size,
  };
}
