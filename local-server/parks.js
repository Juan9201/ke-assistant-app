/**
 * Directorio de parques (spec 004): lee kb/data/parks.json, que genera tools/parks-sync/build-parks.mjs
 * a partir de Gravity y Amusement. Sin red. Se recarga solo si el archivo cambia.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARKS_FILE = path.join(HERE, "..", "kb", "data", "parks.json");

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Convierte el JSON del directorio en la forma que usa el extractor. */
export function buildParks(json) {
  return (json?.parks || []).map((p) => ({
    key: norm(p.code).replace(/ /g, "-"),
    code: p.code,
    name: p.name,
    state: p.state,
    gravityVenueId: p.gravityVenueId,
    locationId: p.amusementLocationId ?? null,
    organizationId: p.amusementOrganizationId ?? null,
    aliases: (p.aliases || []).map(norm).filter(Boolean), // nombre propio: gana a los parciales
    partialAliases: (p.partialAliases || []).map(norm).filter(Boolean), // derivados ("westchase")
  }));
}

let cache = { mtime: -1, parks: [] };

/** Parques actuales (caché por fecha de modificación del archivo). Si no existe, lista vacía. */
export function loadParks(file = PARKS_FILE) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (file === PARKS_FILE && mtime === cache.mtime) return cache.parks;
    const parks = buildParks(JSON.parse(fs.readFileSync(file, "utf8")));
    if (file === PARKS_FILE) cache = { mtime, parks };
    return parks;
  } catch {
    return [];
  }
}

/** Alias más largo que aparece en el texto; devuelve los parques que empatan en esa longitud. */
function longestHits(t, parks, field) {
  let best = 0;
  let hits = [];
  for (const p of parks) {
    for (const a of p[field]) {
      if (!t.includes(` ${a} `)) continue;
      if (a.length > best) {
        best = a.length;
        hits = [p];
      } else if (a.length === best && !hits.includes(p)) {
        hits.push(p);
      }
    }
  }
  return hits;
}

/** Igual que longestHits pero comparando sin espacios ("ca-woodlandhills" ≈ "woodland hills"). Solo alias de 6+ letras. */
function longestHitsSquashed(t, parks, field) {
  const flat = t.replace(/ /g, "");
  let best = 0;
  let hits = [];
  for (const p of parks) {
    for (const a of p[field]) {
      const f = a.replace(/ /g, "");
      if (f.length < 6 || !flat.includes(f)) continue;
      if (f.length > best) {
        best = f.length;
        hits = [p];
      } else if (f.length === best && !hits.includes(p)) {
        hits.push(p);
      }
    }
  }
  return hits;
}

/**
 * Busca el parque en el texto. Primero por el nombre propio (gana el alias más largo) y solo si no hay,
 * por alias parciales. Con { squash: true } reintenta ignorando espacios (útil para correos y códigos como
 * "ca-woodlandhills@kidsempire.us"). Si dos parques distintos empatan, es ambiguo: no se adivina (park = null).
 */
export function matchPark(text, parks, { squash = false } = {}) {
  const t = ` ${norm(text)} `;
  for (const field of ["aliases", "partialAliases"]) {
    const hits = longestHits(t, parks, field);
    if (hits.length === 1) return { park: hits[0], ambiguous: false };
    if (hits.length > 1) return { park: null, ambiguous: true, candidates: hits };
  }
  if (squash) {
    for (const field of ["aliases", "partialAliases"]) {
      const hits = longestHitsSquashed(norm(text), parks, field);
      if (hits.length === 1) return { park: hits[0], ambiguous: false };
      if (hits.length > 1) return { park: null, ambiguous: true, candidates: hits };
    }
  }
  return { park: null, ambiguous: false, candidates: [] };
}

/** Lista para el selector del panel. */
export function parkOptions(parks = loadParks()) {
  return parks.map((p) => ({ key: p.key, code: p.code })).sort((a, b) => a.code.localeCompare(b.code));
}
