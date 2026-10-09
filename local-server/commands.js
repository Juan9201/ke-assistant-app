/**
 * Cola de comandos hacia Connecteam (spec 006).
 *
 * La consola de tickets no puede escribir en Connecteam: solo el listener, que corre dentro de esa pestaña, puede.
 * Por eso las órdenes ("inserta esta respuesta citando ese mensaje", "envía lo insertado") viajan como comandos que
 * el listener consulta y ejecuta. Insertar NO envía; enviar solo ocurre con un comando `send_reply` que una persona
 * pidió desde la consola y que exige que el cuadro contenga exactamente el texto esperado.
 */

import crypto from "node:crypto";

export const TARGETS = ["connecteam"];
export const TYPES = ["insert_reply", "send_reply"];
const MAX_TEXT = 2000;

function validate(type, p) {
  if (!p || typeof p !== "object") return "Faltan los parámetros";
  if (typeof p.ticketId !== "string" || !p.ticketId) return "Falta el ticket";
  if (typeof p.text !== "string" || !p.text.trim()) return "La respuesta está vacía";
  if (p.text.length > MAX_TEXT) return `La respuesta supera ${MAX_TEXT} caracteres`;
  if (type === "insert_reply" && p.messageId != null && typeof p.messageId !== "string") return "messageId inválido";
  return null;
}

export function createCommandStore({ now = () => Date.now(), pendingTtlMs = 120_000, takenTtlMs = 60_000, max = 300 } = {}) {
  const cmds = new Map();
  let seq = 0;

  const expire = () => {
    const t = now();
    for (const c of cmds.values()) {
      if (c.status === "pending" && t - c.createdAt > pendingTtlMs) c.status = "expired";
      else if (c.status === "taken" && t - c.takenAt > takenTtlMs) c.status = "expired";
    }
  };
  const view = (c) => ({ id: c.id, target: c.target, type: c.type, params: c.params, ticketId: c.params.ticketId, status: c.status, createdAt: c.createdAt });

  return {
    create({ target = "connecteam", type, params }) {
      if (!TARGETS.includes(target)) return { ok: false, error: `Destino no permitido: ${target}` };
      if (!TYPES.includes(type)) return { ok: false, error: `Comando no permitido: ${type}` };
      const bad = validate(type, params);
      if (bad) return { ok: false, error: bad };
      expire();
      const clean = {
        ticketId: params.ticketId.slice(0, 40),
        text: params.text.trim(),
        messageId: typeof params.messageId === "string" ? params.messageId.slice(0, 120) : "",
        snippet: typeof params.snippet === "string" ? params.snippet.slice(0, 200) : "", // texto del mensaje a citar, por si el id no coincide
      };
      const c = { id: `cmd-${++seq}-${crypto.randomBytes(3).toString("hex")}`, target, type, params: clean, status: "pending", createdAt: now(), result: null };
      cmds.set(c.id, c);
      while (cmds.size > max) cmds.delete(cmds.keys().next().value);
      return { ok: true, command: view(c) };
    },
    /** Lo llama el ejecutor del destino: toma el comando pendiente más antiguo. */
    next(target) {
      expire();
      for (const c of cmds.values()) {
        if (c.target === target && c.status === "pending") {
          c.status = "taken";
          c.takenAt = now();
          return view(c);
        }
      }
      return null;
    },
    complete(id, { ok, error = "" } = {}) {
      const c = cmds.get(id);
      if (!c) return { ok: false, error: "Comando no encontrado" };
      if (c.status !== "taken") return { ok: false, error: `El comando está en estado ${c.status}` };
      c.status = ok ? "done" : "failed";
      c.error = ok ? "" : String(error).slice(0, 300);
      c.doneAt = now();
      return { ok: true, command: view(c) };
    },
    get(id) {
      expire();
      const c = cmds.get(id);
      return c ? { ...view(c), error: c.error || "" } : null;
    },
    size: () => cmds.size,
  };
}
