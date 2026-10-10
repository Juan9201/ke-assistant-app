import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const constitution = fs.readFileSync(path.join(ROOT, "specs", "constitution.md"), "utf8");
const STATES = ["espacio creado", "borrador", "clarificada", "aprobada", "operativa"];

function lines() {
  const section = constitution.split(/^## /m).find((s) => s.startsWith("Líneas de caso"));
  assert.ok(section, "la constitución tiene la sección «Líneas de caso»");
  return section
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !/^\|\s*(Línea|---)/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()).slice(1, -1))
    .map(([name, specs, kb, state]) => ({ name, specs: specs.split(",").map((s) => s.trim()), kb, state }));
}

const specDir = (n) => fs.readdirSync(path.join(ROOT, "specs")).find((d) => d.startsWith(`${n}-`));

test("el registro lista las siete líneas de caso", () => {
  assert.deepEqual(lines().map((l) => l.name), ["Play Card", "Refunds", "Bookings", "Punch Cards", "Memberships", "Online tickets", "Split payment"]);
});

test("cada línea tiene su spec, y su estado es uno de los permitidos", () => {
  for (const l of lines()) {
    assert.ok(STATES.some((s) => l.state.startsWith(s)), `${l.name}: estado inválido «${l.state}»`);
    for (const n of l.specs) {
      const dir = specDir(n);
      assert.ok(dir, `${l.name}: falta la carpeta de la spec ${n}`);
      assert.ok(fs.existsSync(path.join(ROOT, "specs", dir, "spec.md")), `${l.name}: la spec ${n} no tiene spec.md`);
    }
  }
});

test("una línea sin spec aprobada no responde sola: su política de KB dice 'siempre debe escalar'", (t) => {
  const kbDir = path.join(ROOT, "kb", "docs", "business-logic");
  if (!fs.existsSync(kbDir)) return t.skip("la KB local no está en este equipo");
  for (const l of lines()) {
    const file = path.join(kbDir, l.kb);
    assert.ok(fs.existsSync(file), `${l.name}: falta ${l.kb} en la KB`);
    if (l.state.startsWith("espacio creado") || l.state.startsWith("borrador")) {
      assert.match(fs.readFileSync(file, "utf8"), /\*\*Nivel:\*\*\s*siempre debe escalar/i, `${l.name}: debe escalar mientras no esté aprobada`);
    }
  }
});

test("las specs de líneas nuevas apuntan a la constitución y declaran que no cambian a las demás", () => {
  for (const l of lines().filter((x) => x.state.startsWith("espacio creado"))) {
    const spec = fs.readFileSync(path.join(ROOT, "specs", specDir(l.specs[0]), "spec.md"), "utf8");
    assert.match(spec, /specs\/constitution\.md/);
    assert.match(spec, /NO debe cambiar el comportamiento de Play Card ni de Refunds/);
  }
});
