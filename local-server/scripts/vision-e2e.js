/**
 * Prueba de recorrido completo (spec 003): foto REAL + mensaje de ejemplo → lectura (OCR) → extractor.
 * Responde: ¿lo que lee la visión sirve para resolver el pedido? Muestra qué haría el asistente y compara
 * contra IMG Training/scenarios.json.
 *
 *   node scripts/vision-e2e.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImage } from "../vision.js";
import { analyzeFlameRequest } from "../flamerequest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "..", "IMG Training");
const scenarios = JSON.parse(fs.readFileSync(path.join(DIR, "scenarios.json"), "utf8"));
const cache = new Map();
const get = (obj, p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

let ok = 0;
let total = 0;
for (const [name, sc] of Object.entries(scenarios)) {
  if (name.startsWith("_")) continue;
  const photoId = sc.foto || name;
  const file = fs.readdirSync(DIR).find((f) => path.parse(f).name === photoId && /\.(jpe?g|png)$/i.test(f));
  if (!file) {
    console.log(`\n=== ${name}: no hay foto ${photoId}`);
    continue;
  }
  if (!cache.has(photoId)) cache.set(photoId, await readImage(fs.readFileSync(path.join(DIR, file))));
  const vision = cache.get(photoId);
  const a = analyzeFlameRequest({ text: sc.texto, author: "AM Rashel Carswell", greetingName: "Rashel", vision });
  console.log(`\n=== ${name}   «${sc.texto}»`);
  console.log(`  protocolo: ${a.protocol} · datos completos: ${a.dataReady} · puede aprobar: ${a.canApprove}`);
  console.log(`  entendió: ${a.understood}`);
  const f = a.fields || {};
  if (a.protocol === "receipt") console.log(`  campos: parque=${f.parkCode} (${f.parkSource}) · loc=${f.locationId} · recibo=${f.receiptNumber} (${f.receiptSource}) · tarjeta=${f.card} · flames=${f.flames} · $${f.amountUsd}`);
  if (a.blockers.length) console.log(`  bloqueos: ${a.blockers.join(" | ")}`);
  if (a.pendingChecks.length) console.log(`  pendiente: ${a.pendingChecks.length} lectura(s) en Gravity/Amusement (T-07/T-08)`);
  if (a.warnings?.length) console.log(`  avisos: ${a.warnings.join(" | ")}`);
  console.log(`  responde: ${a.reply ?? "(nada al staff; listo para validar en Gravity)"}`);
  for (const [k, want] of Object.entries(sc.espera || {})) {
    total++;
    const key = k.replace(/~$/, "");
    const got = get(a, key);
    const pass = k.endsWith("~") ? String(Array.isArray(got) ? got.join(" ") : got ?? "").includes(want) : got === want || (want === null && got == null);
    if (pass) ok++;
    else console.log(`  ✖ ${key}: esperado ${JSON.stringify(want)} · obtuvo ${JSON.stringify(got)}`);
  }
}
console.log(`\nAciertos: ${ok}/${total} (${Math.round((100 * ok) / total)}%)`);
