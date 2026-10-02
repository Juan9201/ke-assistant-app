/**
 * KE Assistant — server local (reemplaza al Worker de Cloudflare para desarrollo
 * o para correr todo en tu propia máquina).
 *
 * Solo capa de transporte HTTP: la lógica de negocio vive en logic.js, sin cambios,
 * así que el día que quieras volver a Cloudflare solo hay que reescribir este
 * archivo, no logic.js.
 *
 * Escucha SOLO en 127.0.0.1 (nunca 0.0.0.0): nadie fuera de esta máquina puede
 * pegarle a este servidor, ni siquiera otros dispositivos en la misma red.
 */

import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { handleAction, HttpError } from "./logic.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY_BYTES = 1_000_000; // 1 MB; de sobra para un mensaje de chat o una regla

const env = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_OWNER: process.env.GITHUB_OWNER,
  GITHUB_REPO: process.env.GITHUB_REPO,
  GITHUB_BRANCH: process.env.GITHUB_BRANCH,
  KB_ROOT: process.env.KB_ROOT,
};

const SHARED_SECRET = process.env.SHARED_SECRET || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());

function corsHeaders(req) {
  const origin = req.headers.origin;
  let allowOrigin = "*";
  if (!ALLOWED_ORIGINS.includes("*")) {
    allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shared-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function sendJson(res, status, headers, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function isAuthorized(req) {
  if (!SHARED_SECRET) return false; // sin secret configurado, no se autoriza nada
  const provided = Buffer.from(String(req.headers["x-shared-secret"] || ""), "utf8");
  const expected = Buffer.from(SHARED_SECRET, "utf8");
  if (provided.length !== expected.length) {
    crypto.timingSafeEqual(expected, expected); // mismo costo que una comparación real
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Cuerpo de la solicitud demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const headers = corsHeaders(req);
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, headers, { ok: true, version: "local" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, headers, { error: "Method not allowed" });
    return;
  }

  try {
    if (!SHARED_SECRET) {
      throw new HttpError(500, "Falta SHARED_SECRET en .env");
    }
    if (!isAuthorized(req)) {
      sendJson(res, 401, headers, { error: "Unauthorized" });
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError(400, "No se pudo leer el cuerpo de la solicitud");
    }

    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new HttpError(400, "El cuerpo debe ser JSON válido");
    }

    const result = await handleAction(body.action, body, env);
    sendJson(res, 200, headers, result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    sendJson(res, status, headers, { error: err.message || "Error interno" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`KE Assistant local server escuchando en http://${HOST}:${PORT}`);
  if (!SHARED_SECRET) {
    console.warn("⚠️  Falta SHARED_SECRET en .env — todas las solicitudes serán rechazadas.");
  }
});
