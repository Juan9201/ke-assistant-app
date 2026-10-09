/**
 * KE Assistant — registro de logs (spec 001 (logs)).
 *
 * Cada caso es una log: eventos ordenados que cuentan qué pasó y qué se pensó.
 * Se guardan como JSONL (un archivo por día) en data/logs/, carpeta fuera de git.
 * Nunca se guardan secretos: las claves sensibles se reemplazan al registrar.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const EVENT_KINDS = [
  "input",
  "match",
  "thought",
  "extract",
  "check",
  "action",
  "evidence",
  "decision",
  "reply",
  "escalation",
  "error",
  "vision", // qué leyó la foto: hallazgos, posición y confianza (spec 003)
  "approval", // Juan aprobó o negó
  "step", // progreso: "paso i de N" con estado start | done | fail (para la barra y el cronómetro)
];

export const STEP_STATES = ["start", "done", "fail"];

/** Únicos sistemas donde el agente puede actuar o buscar (spec 001, R-11). */
export const ALLOWED_SYSTEMS = ["connecteam", "gravity", "amusement"];

export const OUTCOMES = ["answered", "asked_missing_data", "prepared_for_human", "executed", "denied", "escalated", "error"];

const SENSITIVE_KEY = /secret|token|api[-_]?key|password|authorization|passwd/i;
const REDACTED = "[REDACTADO]";
const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "logs");

/** Copia profunda que reemplaza el valor de cualquier clave sensible. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v);
    return out;
  }
  return value;
}

/** Lee todos los .jsonl del directorio y agrupa los eventos por caso (más reciente primero). */
export function loadLogs(dir = DEFAULT_DIR) {
  const cases = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!rec.caseId) continue;
      if (!cases.has(rec.caseId)) cases.set(rec.caseId, { id: rec.caseId, events: [] });
      cases.get(rec.caseId).events.push(rec);
    }
  }
  const out = [...cases.values()];
  for (const c of out) c.events.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  out.sort((a, b) => b.events[0].ts.localeCompare(a.events[0].ts));
  return out;
}

export function createLog(meta = {}, { dir = DEFAULT_DIR } = {}) {
  const caseId = String(meta.caseId || crypto.randomUUID());
  let seq = 0;
  let closed = false;

  fs.mkdirSync(dir, { recursive: true });

  function write(record) {
    const ts = new Date().toISOString();
    const file = path.join(dir, `${ts.slice(0, 10)}.jsonl`);
    const line = JSON.stringify(redact({ ts, caseId, seq: seq++, ...record }));
    fs.appendFileSync(file, line + "\n", "utf8");
  }

  return {
    caseId,
    /** kind: ver EVENT_KINDS. detail: texto libre (el razonamiento). data: objeto con datos. */
    add(kind, title, detail = "", data = undefined) {
      if (closed) throw new Error("El log ya está cerrado");
      if (!EVENT_KINDS.includes(kind)) throw new Error(`Tipo de evento inválido: ${kind}`);
      if (kind === "action") {
        const system = data && data.system;
        if (!system) throw new Error("Toda acción debe declarar el sistema (connecteam, gravity o amusement)");
        if (!ALLOWED_SYSTEMS.includes(system)) throw new Error(`Fuera de alcance: el sistema "${system}" no está permitido`);
      }
      write({ kind, title: String(title || ""), detail: String(detail || ""), ...(data !== undefined && { data }) });
    },
    /** Marca el avance: paso `index` de `total`. state: start | done | fail. */
    step(index, total, label, state = "start", detail = "") {
      if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
        throw new Error(`Paso fuera de rango: ${index} de ${total}`);
      }
      if (!STEP_STATES.includes(state)) throw new Error(`Estado de paso inválido: ${state}`);
      this.add("step", label, detail, { index, total, state });
    },
    end(outcome, summary = "") {
      if (closed) throw new Error("El log ya está cerrado");
      if (!OUTCOMES.includes(outcome)) throw new Error(`Outcome inválido: ${outcome}`);
      closed = true;
      write({ kind: "end", title: "Caso cerrado", detail: String(summary || ""), outcome, meta: redact(meta) });
    },
  };
}

/** Eventos de UN caso (por su caseId): lee solo las líneas que lo mencionan, sin armar todos los casos. */
export function loadCaseEvents(caseIds, dir = DEFAULT_DIR) {
  const ids = (Array.isArray(caseIds) ? caseIds : [caseIds]).filter(Boolean);
  if (!ids.length) return [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line || !ids.some((id) => line.includes(id))) continue;
      try {
        const rec = JSON.parse(line);
        if (ids.includes(rec.caseId)) out.push(rec);
      } catch {
        /* línea dañada: se ignora */
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
}
