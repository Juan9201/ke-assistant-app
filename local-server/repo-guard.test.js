/**
 * Guardián de estructura del repo (constitución, principio 5: secretos fuera de todo).
 * Recorre los archivos del proyecto que se suben a GitHub (el repo es PÚBLICO) y falla si encuentra algo que parece un secreto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "kb", "IMG Training", "data", ".wrangler"]);
const SKIP_FILES = new Set([".env", ".dev.vars", "package-lock.json"]);
const TEXT = /\.(js|mjs|json|md|html|py|toml|yaml|yml|txt|bat|example|gitignore)$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (!SKIP_FILES.has(e.name) && (TEXT.test(e.name) || e.name.startsWith(".")) && !e.name.startsWith("KE Assistant")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}
const FILES = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");

// Archivos que git protege localmente (skip-worktree: llevan tu secreto SOLO en tu PC y nunca se suben). De esos se revisa
// la versión que de verdad se subiría (la del índice), no tu copia local.
function skipWorktree() {
  try {
    return new Set(execFileSync("git", ["ls-files", "-v"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((l) => l.startsWith("S ")).map((l) => l.slice(2)));
  } catch {
    return new Set();
  }
}
const PROTEGIDOS = skipWorktree();
function contenido(f) {
  const r = rel(f);
  if (PROTEGIDOS.has(r)) {
    try {
      return execFileSync("git", ["show", `:${r}`], { cwd: ROOT, encoding: "utf8" });
    } catch {
      return "";
    }
  }
  return fs.readFileSync(f, "utf8");
}

// Valores permitidos como "secreto": marcadores, valores de prueba de los tests y ejemplos.
const OK_SECRET = /^(__SHARED_SECRET__|PEGA_AQUI[\w]*|testsecret|secreto-de-prueba|otro|x|tu-[\w-]+|\$\{[^}]+\}|)$/i;

test("ningún archivo del repo asigna un SHARED_SECRET real", () => {
  const malos = [];
  for (const f of FILES) {
    const src = contenido(f);
    for (const m of src.matchAll(/SHARED_SECRET["']?\s*[:=]\s*["']([^"']*)["']/g)) {
      if (!OK_SECRET.test(m[1])) malos.push(`${rel(f)} → SHARED_SECRET con ${m[1].length} caracteres`);
    }
  }
  assert.deepEqual(malos, []);
});

test("ningún archivo contiene claves de API, tokens de GitHub o credenciales conocidas", () => {
  const patrones = [
    [/sk-[A-Za-z0-9]{20,}/, "clave tipo sk-"],
    [/gh[pousr]_[A-Za-z0-9]{30,}/, "token de GitHub"],
    [/github_pat_[A-Za-z0-9_]{30,}/, "token fino de GitHub"],
    [/AKIA[0-9A-Z]{16}/, "clave de AWS"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "llave privada"],
    [/(?:LLM_API_KEY|GITHUB_TOKEN)\s*=\s*(?!PEGA_AQUI|tu[_-])[A-Za-z0-9_\-]{16,}/, "variable de .env con valor"],
    [/password\s*[:=]\s*["'][^"']{6,}["']/i, "contraseña en texto"],
  ];
  const malos = [];
  for (const f of FILES) {
    const src = contenido(f);
    for (const [re, que] of patrones) if (re.test(src)) malos.push(`${rel(f)} → ${que}`);
  }
  assert.deepEqual(malos, []);
});

test("los userscripts del repo solo llevan el marcador del secreto, que el servidor reemplaza al entregarlos", () => {
  const dir = path.join(ROOT, "userscript");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".user.js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (/SHARED_SECRET/.test(src)) assert.ok(src.includes("__SHARED_SECRET__") || /PEGA_AQUI/.test(src), `${f} no usa el marcador`);
  }
});

test("las carpetas con datos sensibles están en .gitignore (fotos con huéspedes, logs con mensajes reales, KB, .env)", () => {
  const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  for (const entrada of ["IMG Training/", "local-server/data/", "/kb/", ".env"]) assert.ok(gi.includes(entrada), `falta ${entrada} en .gitignore`);
});

test("los fixtures de pruebas no traen nombres de huéspedes, teléfonos ni números de tarjeta de pago", () => {
  const dir = path.join(ROOT, "local-server", "test-fixtures");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/Name\(s\)\s*:\s*[A-Z][a-z]+ [A-Z]/.test(src), `${f}: nombres`);
    assert.ok(!/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(src), `${f}: teléfono`);
    assert.ok(!/\b4\d{15}\b|\b5[1-5]\d{14}\b/.test(src), `${f}: número de tarjeta de pago`);
  }
});

test("hay una carpeta de specs con spec, plan y tasks para las capacidades en curso", () => {
  const specs = path.join(ROOT, "specs");
  for (const d of ["001-trace-log", "002-panel-aprobacion", "003-vision"]) assert.ok(fs.existsSync(path.join(specs, d, "spec.md")), `${d}/spec.md`);
  for (const d of ["002-panel-aprobacion", "003-vision"]) assert.ok(fs.existsSync(path.join(specs, d, "plan.md")), `${d}/plan.md`);
  assert.ok(fs.existsSync(path.join(specs, "002-panel-aprobacion", "tasks.md")));
});
