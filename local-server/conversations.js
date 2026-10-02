/**
 * Memoria de conversación de corto plazo.
 *
 * Un registro liviano por persona, con soporte para varios "casos" abiertos
 * simultáneos (ej. un problema de tarjetas de juego y un booking al mismo
 * tiempo, de la misma persona). Vive en un archivo JSON local — NUNCA debe
 * subirse a GitHub: contiene texto real de conversaciones/clientes, a
 * diferencia de kb/, que solo tiene reglas de negocio.
 *
 * Se borra solo: cualquier caso sin actividad en las últimas 24 horas se
 * elimina en el siguiente barrido (limpieza perezosa, sin cron ni proceso
 * aparte). Es suficiente para el volumen de mensajes de este proyecto — no
 * se maneja escala de miles de chats simultáneos.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "data", "conversations.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas: los casos deben resolverse en ~3h, esto es solo el tope de borrado
const MAX_HISTORY_PER_CASE = 12; // mensajes (nuestros + de la persona) que se guardan por caso

export function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {}; // no existe todavía, o está corrupto: se empieza de cero
  }
}

export function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/** Quita, en el propio objeto, cualquier caso (y persona sin casos) sin actividad en 24h. */
export function cleanupExpired(store, now = Date.now()) {
  for (const personKey of Object.keys(store)) {
    const person = store[personKey];
    for (const caseId of Object.keys(person.cases || {})) {
      const last = new Date(person.cases[caseId].lastActivityAt).getTime();
      if (!Number.isFinite(last) || now - last > TTL_MS) {
        delete person.cases[caseId];
      }
    }
    if (!person.cases || Object.keys(person.cases).length === 0) {
      delete store[personKey];
    }
  }
  return store;
}

/** Llave estable por persona: nombre completo (sin el rango) sin acentos, en minúsculas. */
export function personKeyFrom(author) {
  return String(author || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(text) {
  const s = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "persona";
}

/** Casos abiertos de una persona, listos para mostrarle al modelo (id, categoría, historial). */
export function getOpenCases(store, personKey) {
  if (!personKey || !store[personKey]) return [];
  return Object.entries(store[personKey].cases).map(([id, c]) => ({
    id,
    category: c.category,
    messages: c.messages,
  }));
}

/** Crea un caso nuevo para esa persona y devuelve su id (ej. "brian-way-jr-2"). */
export function createCase(store, personKey, category, rawAuthor) {
  if (!store[personKey]) store[personKey] = { counter: 0, rawAuthor, cases: {} };
  store[personKey].counter += 1;
  const id = `${slugify(rawAuthor || personKey)}-${store[personKey].counter}`;
  store[personKey].cases[id] = {
    category: category || "general",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    messages: [],
  };
  return id;
}

/** Agrega el intercambio (mensaje de la persona + nuestra respuesta) al caso, recortando el historial. */
export function appendExchange(store, personKey, caseId, theirText, ourText) {
  const c = store[personKey]?.cases?.[caseId];
  if (!c) return;
  const now = new Date().toISOString();
  c.messages.push({ from: "them", text: theirText, at: now }, { from: "us", text: ourText, at: now });
  if (c.messages.length > MAX_HISTORY_PER_CASE) {
    c.messages = c.messages.slice(-MAX_HISTORY_PER_CASE);
  }
  c.lastActivityAt = now;
}
