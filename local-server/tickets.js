/**
 * Almacén de tickets (spec 006). Cada pedido de flames es un ticket persistente (data/tickets.json, fuera de git).
 *
 * Un ticket reúne los mensajes del mismo staff: si el asistente pregunta "¿en qué parque estás?" y la misma persona
 * responde "Arlington", ese mensaje se suma al mismo ticket (dentro de una ventana de tiempo) y el análisis usa el conjunto.
 * Guarda texto, URLs de fotos y datos operativos del análisis; nunca la imagen ni datos de pago.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "tickets.json");

export const STATUSES = ["new", "waiting_staff", "needs_rectification", "ready_for_approval", "escalated", "denied", "approved", "resolved"];
/** Estados que fija una persona: el análisis ya no los cambia. */
export const MANUAL_STATUSES = ["denied", "approved", "resolved"];
/** Estados en los que un mensaje nuevo del mismo autor se considera continuación del ticket. */
const CONTINUABLE = ["waiting_staff", "needs_rectification"];
const CONTINUE_WINDOW_MS = 45 * 60 * 1000;
const MAX_TICKETS = 1000;
const MAX_MESSAGES = 40;
const MAX_THREAD = 200;

const authorKey = (a) => String(a || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clip = (s, n) => String(s ?? "").slice(0, n);
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u) && u.length <= 800;

/** Estado derivado del análisis (los estados manuales no se tocan). */
export function statusFromAnalysis(a) {
  if (!a) return "new";
  if (a.protocol === "out_of_scope" || a.verdict === "escalate") return "escalated";
  if (a.verdict === "B") return "needs_rectification";
  if (a.reply && a.replyKind === "question") return "waiting_staff";
  if (a.verdict === "A" || a.dataReady) return "ready_for_approval";
  return "new";
}

export function createTicketStore({ file = DEFAULT_FILE, now = () => Date.now(), continueWindowMs = CONTINUE_WINDOW_MS } = {}) {
  let state = { seq: 0, tickets: [] };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && Array.isArray(j.tickets)) state = { seq: Number(j.seq) || j.tickets.length, tickets: j.tickets };
  } catch {
    /* sin archivo todavía */
  }

  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file); // escritura atómica: un corte no deja el archivo a medias
    } catch (e) {
      console.error("No se pudo guardar tickets:", e.message);
    }
  };

  const byId = (id) => state.tickets.find((t) => t.id === id) || null;
  const byCase = (caseId) => (caseId ? state.tickets.find((t) => t.caseId === caseId || t.aliases.includes(caseId)) || null : null);

  const summary = (t) => ({
    id: t.id,
    number: t.number,
    caseId: t.caseId,
    author: t.author,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    snippet: clip(t.messages[0]?.text || "(foto)", 140),
    parkCode: t.analysis?.fields?.parkCode || null,
    receiptNumber: t.analysis?.fields?.receiptNumber || null,
    protocol: t.analysis?.protocol || null,
    verdict: t.analysis?.verdict || null,
    messages: t.messages.length,
    hasImages: t.messages.some((m) => m.images.length),
  });

  function cleanMessage(m) {
    return {
      key: clip(m.messageKey, 200),
      messageId: clip(m.messageId, 120),
      text: clip(m.text, 4000),
      images: (Array.isArray(m.images) ? m.images : []).filter(isHttp).slice(0, 6),
      ts: Number(m.ts) || now(),
    };
  }

  return {
    /** Ticket al que pertenece un mensaje: por caseId (o alias) o, si no, el ticket abierto del mismo autor. */
    resolve({ caseId, author }) {
      const exact = byCase(caseId);
      if (exact) return { ticket: exact, continued: false };
      const key = authorKey(author);
      if (!key) return null;
      const t = now();
      const open = [...state.tickets].reverse().find((x) => x.authorKey === key && CONTINUABLE.includes(x.status) && t - x.updatedAt < continueWindowMs);
      return open ? { ticket: open, continued: true } : null;
    },

    /** Texto conjunto del ticket, opcionalmente con un mensaje nuevo (sin guardarlo todavía). */
    combinedText(ticket, extra = null) {
      // Un mensaje con la misma llave pero otro texto es el mismo mensaje editado: manda el texto nuevo.
      const texts = ticket.messages.map((m) => (extra && m.key === extra.messageKey && extra.text ? extra.text : m.text));
      if (extra && !ticket.messages.some((m) => m.key === extra.messageKey)) texts.push(extra.text);
      return texts.filter(Boolean).join("\n");
    },

    create({ caseId, messageKey, messageId, author, text, images, ts, channel }) {
      const msg = cleanMessage({ messageKey: messageKey || caseId, messageId, text, images, ts });
      const t = now();
      const ticket = {
        id: `T${String(++state.seq).padStart(4, "0")}`,
        number: state.seq,
        caseId: clip(caseId, 120),
        aliases: [],
        author: clip(author, 200),
        authorKey: authorKey(author),
        channel: clip(channel || "Gravity Support", 80),
        createdAt: t,
        updatedAt: t,
        status: "new",
        messages: [msg],
        thread: [],
        analysis: null,
        overrides: {},
        draft: null,
        lastInserted: null,
      };
      state.tickets.push(ticket);
      while (state.tickets.length > MAX_TICKETS) state.tickets.shift();
      save();
      return ticket;
    },

    /** Suma un mensaje (si aún no estaba) y, si venía con otro caseId, lo guarda como alias del ticket. */
    appendMessage(id, m, caseId = "") {
      const t = byId(id);
      if (!t) return null;
      const msg = cleanMessage(m);
      const known = t.messages.find((x) => x.key === msg.key);
      if (known) {
        // el mismo mensaje con fotos que no se habían visto antes (o con el texto editado)
        for (const u of msg.images) if (!known.images.includes(u)) known.images.push(u);
        if (msg.text && msg.text !== known.text) known.text = msg.text;
      } else if (t.messages.length < MAX_MESSAGES) {
        t.messages.push(msg);
      }
      if (caseId && caseId !== t.caseId && !t.aliases.includes(caseId)) t.aliases.push(clip(caseId, 120));
      t.updatedAt = now();
      save();
      return t;
    },

    setAnalysis(id, analysis) {
      const t = byId(id);
      if (!t) return null;
      t.analysis = analysis;
      if (!MANUAL_STATUSES.includes(t.status)) t.status = statusFromAnalysis(analysis);
      t.updatedAt = now();
      save();
      return t;
    },

    setStatus(id, status) {
      const t = byId(id);
      if (!t || !STATUSES.includes(status)) return null;
      t.status = status;
      t.updatedAt = now();
      save();
      return t;
    },

    /** Reabre un ticket cerrado a mano: vuelve al estado que dicta su análisis. */
    reopen(id) {
      const t = byId(id);
      if (!t) return null;
      t.status = statusFromAnalysis(t.analysis);
      t.updatedAt = now();
      save();
      return t;
    },

    mergeOverrides(id, overrides) {
      const t = byId(id);
      if (!t) return null;
      const allowed = ["parkKey", "card", "receiptNumber", "flames", "amountUsd"];
      for (const [k, v] of Object.entries(overrides || {})) {
        if (!allowed.includes(k)) continue;
        if (v === "" || v == null) delete t.overrides[k];
        else t.overrides[k] = v;
      }
      t.updatedAt = now();
      save();
      return t;
    },

    setDraft(id, text) {
      const t = byId(id);
      if (!t) return null;
      t.draft = text == null ? null : clip(text, 2000);
      save();
      return t;
    },

    addThread(id, { role, kind, text }) {
      const t = byId(id);
      if (!t) return null;
      t.thread.push({ role: clip(role, 20), kind: clip(kind, 30), text: clip(text, 2000), ts: now() });
      if (t.thread.length > MAX_THREAD) t.thread.shift();
      t.updatedAt = now();
      save();
      return t;
    },

    setLastInserted(id, text) {
      const t = byId(id);
      if (!t) return null;
      t.lastInserted = text == null ? null : clip(text, 2000);
      save();
      return t;
    },

    /** El caseId canónico (el del primer mensaje) para cualquiera de sus alias. */
    canonicalCase(caseId) {
      return byCase(caseId)?.caseId || caseId;
    },

    get: byId,
    findByCase: byCase,
    list: () => state.tickets.map(summary),
    size: () => state.tickets.length,
  };
}
