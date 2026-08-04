import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mappingKey(category, stampworldId) {
  return `${String(category ?? "").trim()}::${String(stampworldId ?? "").trim()}`;
}

function setMappingKey(category, setRef, stampworldId) {
  return `${String(category ?? "").trim()}::${String(setRef ?? "").trim()}::${String(stampworldId ?? "").trim()}`;
}

/** Load catalogs/<catalog>/<country>.json; unknown/custom countries get an empty map. */
export function load_catalog_crosswalk(catalog, country) {
  const catalogId = String(catalog ?? "").trim().toLowerCase();
  const countryId = String(country ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(catalogId) || !/^[a-z0-9_-]+$/.test(countryId)) {
    throw new Error("catalog crosswalk names must contain only letters, numbers, _ or -");
  }
  const filePath = path.join(PACKAGE_DIR, "catalogs", catalogId, `${countryId}.json`);
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { catalog: catalogId, country: countryId, version: 1, mappings: {} };
    }
    throw error;
  }
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`catalog crosswalk must be an object: ${filePath}`);
  }
  return doc;
}

/** Add external catalog identifiers to stamps without replacing StampWorld ids. */
export function apply_catalog_crosswalk(periods, catalog, crosswalk) {
  const catalogId = String(catalog ?? "").trim().toLowerCase();
  const mappings = crosswalk?.mappings;
  if (!catalogId || !mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    return periods;
  }

  for (const period of Object.values(periods ?? {})) {
    for (const set of period?.sets ?? []) {
      const category = String(set.category ?? "").trim();
      const setRef = String(set.ref ?? "").trim();
      for (const stamp of set.stamps ?? []) {
        const stampworldId = String(stamp.no ?? "").trim();
        if (!stampworldId) continue;
        const assertion = (setRef && mappings[setMappingKey(category, setRef, stampworldId)])
          || mappings[mappingKey(category, stampworldId)];
        const numbers = Array.isArray(assertion?.numbers)
          ? assertion.numbers.map(String).map((v) => v.trim()).filter(Boolean)
          : assertion?.number != null
            ? [String(assertion.number).trim()].filter(Boolean)
            : [];
        if (!numbers.length) continue;
        stamp.catalogs = {
          ...(stamp.catalogs && typeof stamp.catalogs === "object" ? stamp.catalogs : {}),
          [catalogId]: numbers,
        };
      }
    }
  }
  return periods;
}

export default { load_catalog_crosswalk, apply_catalog_crosswalk };
