/** Curated, country-qualified selections from locally collected catalogs. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consolidate_periods } from "./consolidate.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function identifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must contain only lowercase letters, numbers, _ or -`);
  }
  return value;
}

export function load_thematic_catalog(id) {
  identifier(id, "thematic catalog id");
  return JSON.parse(readFileSync(path.join(PACKAGE_DIR, "catalogs", "thematic", `${id}.json`), "utf8"));
}

/**
 * Resolve explicit {country, category, no, set_ref?} references. Numbers are
 * Source record strings (usually StampWorld, including leading zeros). Missing/ambiguous entries fail
 * the build; set_ref disambiguates numbers reused by different issues.
 */
export function consolidate_thematic_catalog(catalog, output_dir = "output") {
  const id = identifier(catalog?.id, "thematic catalog id");
  if (catalog.kind !== "thematic" || !Array.isArray(catalog.entries)) {
    throw new Error("thematic catalog requires kind: thematic and an entries array");
  }
  const countries = new Map();
  const periods = {};
  const selected = new Set();
  for (const entry of catalog.entries) {
    const country = identifier(entry?.country, "entry country");
    if (typeof entry.category !== "string" || !entry.category.trim()
        || typeof entry.no !== "string" || !entry.no.trim()
        || (entry.set_ref !== undefined && (typeof entry.set_ref !== "string" || !entry.set_ref.trim()))) {
      throw new Error("thematic entry requires category and no strings, and an optional nonempty set_ref string");
    }
    if (!countries.has(country)) {
      countries.set(country, consolidate_periods(path.join(output_dir, country)));
    }
    const source = countries.get(country);
    const matches = [];
    for (const [period, doc] of Object.entries(source.periods)) {
      for (const set of doc.sets) {
        if (set.category !== entry.category || (entry.set_ref !== undefined && set.ref !== entry.set_ref)) continue;
        for (const stamp of set.stamps) {
          if (String(stamp.no) === entry.no) matches.push({ period, set, stamp });
        }
      }
    }
    const label = `${country} / ${entry.category} / ${entry.no}`;
    if (matches.length !== 1) {
      throw new Error(`thematic entry ${label}: ${matches.length ? "ambiguous; specify set_ref" : "not found"}`);
    }
    const { period, set, stamp } = matches[0];
    const setId = JSON.stringify([country, set.category, period, set.id ?? set.ref]);
    const stampId = JSON.stringify([setId, entry.no]);
    if (selected.has(stampId)) throw new Error(`duplicate thematic entry: ${label}`);
    selected.add(stampId);
    const doc = periods[period] ??= { sets: [], setCount: 0, stampCount: 0 };
    let target = doc.sets.find((s) => s.id === setId);
    if (!target) {
      target = {
        ...set,
        id: setId,
        source_id: set.id,
        country,
        country_name: source.country,
        code: source.code,
        base: set.base ?? source.base,
        stamps: [],
      };
      doc.sets.push(target);
      doc.setCount++;
    }
    target.stamps.push({ ...stamp, country });
    doc.stampCount++;
  }
  return {
    id, kind: "thematic", title: catalog.title ?? id,
    ...(catalog.description ? { description: catalog.description } : {}),
    ...(catalog.notes ? { notes: catalog.notes } : {}),
    ...(catalog.sources ? { sources: catalog.sources } : {}),
    countries: [...countries.keys()],
    summary: { stampCount: selected.size, setCount: Object.values(periods).reduce((n, p) => n + p.setCount, 0) },
    periods: Object.fromEntries(Object.entries(periods).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export default { load_thematic_catalog, consolidate_thematic_catalog };
