import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRolePrefixes, extractGreetingName } from "./logic.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const glossary = () => fs.readFileSync(path.join(HERE, "..", "kb", "docs", "glosario.md"), "utf8");

test("la tabla de rangos incluye AM, M, C, RTM y el prefijo literal *", () => {
  const p = parseRolePrefixes(glossary());
  for (const r of ["AM", "M", "C", "RTM", "*"]) assert.ok(p.has(r), `falta el rango ${r}`);
});

test("el nombre para saludar sale sin el rango", () => {
  const p = parseRolePrefixes(glossary());
  assert.equal(extractGreetingName("AM Rashel Carswell", p), "Rashel");
  assert.equal(extractGreetingName("RTM Jorge Test", p), "Jorge");
  assert.equal(extractGreetingName("C Maria Lopez", p), "Maria");
  assert.equal(extractGreetingName("* paquito contreras", p), "paquito");
});

test("sin rango conocido no se recorta nada (no se corrompen nombres reales)", () => {
  const p = parseRolePrefixes(glossary());
  assert.equal(extractGreetingName("Juan Garcia", p), "Juan");
  assert.equal(extractGreetingName("JJ Smith", p), "JJ");
});

test("un '*' solo, sin nombre, no se convierte en saludo (spec 007 R-03)", () => {
  const p = parseRolePrefixes(glossary());
  assert.equal(extractGreetingName("*", p), "");
});

test("regresión: el '*' se omite aunque la tabla de rangos no lo tenga (spec 007 R-01/R-04)", () => {
  assert.equal(extractGreetingName("* Crystal Mercado", new Set()), "Crystal");
  assert.equal(extractGreetingName("* Crystal Mercado", new Set(["AM"])), "Crystal");
  assert.equal(extractGreetingName("AM Rashel Carswell", new Set()), "AM"); // las letras sí dependen de la tabla (R-02)
});
