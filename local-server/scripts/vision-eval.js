/**
 * Evalúa la lectura de fotos con las imágenes de "IMG Training" (spec 003): lee cada foto con el OCR real,
 * muestra lo que encontró y lo compara con lo esperado (IMG Training/expected.json, si existe).
 *
 *   node scripts/vision-eval.js            # todas las fotos
 *   node scripts/vision-eval.js S01 03     # solo algunas
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImage } from "../vision.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "..", "IMG Training");
const expectedFile = path.join(DIR, "expected.json");
const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, "utf8")) : {};
const only = process.argv.slice(2);
const files = fs.readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).filter((f) => !only.length || only.includes(path.parse(f).name)).sort();

const byType = {}; // aciertos por tipo de documento (paper / screen)
let total = 0;
let ok = 0;
const rows = [];
for (const f of files) {
  const id = path.parse(f).name;
  const t0 = Date.now();
  let r;
  try {
    r = await readImage(fs.readFileSync(path.join(DIR, f)));
  } catch (e) {
    console.log(`\n=== ${id}: ERROR ${e.message}`);
    continue;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const x = r.facts;
  const got = {
    type: r.docType,
    receipt: x.receiptNumber || (x.receiptConflict ? `CONFLICTO ${x.receiptConflict}` : null),
    park: x.parkCode || null,
    flames: x.flames ? `${x.flames.unitAmount}=${x.flames.flamesPerUnit}x${x.flames.qty}` : null,
    arcade: x.arcadeAmount ?? null,
    playCard: x.playCardOnReceipt ?? x.playCardLast4 ?? null,
    wristbands: x.wristbandQty ?? null,
  };
  console.log(`\n=== ${id} [${r.docType}] (${r.width}x${r.height}, ${secs}s, ${r.lines.length} líneas)`);
  console.log("  leyó:", JSON.stringify(got));
  const lows = r.findings.filter((f2) => f2.lowConfidence && !f2.ignored).map((f2) => `${f2.kind}@${Math.round(f2.score * 100)}%`);
  if (lows.length) console.log("  baja confianza:", lows.join(", "));
  console.log("  no encontró:", r.notFound.join(", ") || "—");
  const exp = expected[id];
  if (exp) {
    for (const [k, v] of Object.entries(exp)) {
      total++;
      const pass = String(got[k] ?? null) === String(v);
      const tp = exp.type || r.docType;
      byType[tp] ||= { ok: 0, total: 0 };
      byType[tp].total++;
      if (pass) {
        ok++;
        byType[tp].ok++;
      }
      rows.push(`${pass ? "✔" : "✖"} ${id}.${k}: esperado ${JSON.stringify(v)} · leyó ${JSON.stringify(got[k] ?? null)}`);
    }
  }
}
if (rows.length) {
  console.log("\n--- Resultado contra lo esperado ---\n" + rows.join("\n"));
  console.log(`\nAciertos: ${ok}/${total} (${Math.round((100 * ok) / total)}%)`);
  for (const [tp, s] of Object.entries(byType)) console.log(`  · ${tp}: ${s.ok}/${s.total} (${Math.round((100 * s.ok) / s.total)}%)`);
}
