/**
 * Country packs live at countries/<id>.xp and declare one named concept, e.g.:
 *
 *   China:
 *     stampworld: China,-Peoples-Rep.
 *     categories: ["Postage stamps"]
 *     periods: ["1990-1999", ...]
 *
 * Select with: --with country=china
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consolidate_periods } from "./consolidate.js";
import { country_output_dir } from "./scrape.js";

const require = createRequire("/app/package.json");
const { parse: parseYaml } = require("yaml");

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load countries/<id>.xp and return its country concept.
 * `id` comes from `--with country=<id>` (also used as output/ folder name).
 */
export function load_country(id) {
  const key = String(id ?? "").trim();
  if (!key) {
    throw new Error("load_country: pass --with country=<id> (e.g. country=china)");
  }
  if (key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new Error(`load_country: invalid country id: ${key}`);
  }
  const filePath = path.join(PACKAGE_DIR, "countries", `${key}.xp`);
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`load_country: missing country pack ${filePath}`);
  }
  const parts = text.split(/^---\s*$/m).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`load_country: empty country pack ${filePath}`);
  }
  const doc = parseYaml(parts[0]);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`load_country: expected a mapping in ${filePath}`);
  }
  const names = Object.keys(doc).filter((k) => !k.startsWith("_"));
  if (names.length !== 1) {
    throw new Error(
      `load_country: ${path.basename(filePath)} must declare exactly one country concept (found ${names.join(", ") || "none"})`,
    );
  }
  const concept = doc[names[0]];
  if (!concept || typeof concept !== "object" || Array.isArray(concept)) {
    throw new Error(`load_country: concept ${names[0]} must be a mapping`);
  }
  return {
    ...concept,
    id: key,
    name: names[0],
  };
}

/**
 * Map a country concept → catalogue scrape query.
 * `country` is the StampWorld slug (URL); `id` is the output/ folder name.
 */
export function as_catalog_query(country) {
  if (!country || typeof country !== "object" || Array.isArray(country)) {
    throw new Error("as_catalog_query expects a country concept object");
  }
  const stampworld = String(country.stampworld ?? "").trim();
  if (!stampworld) {
    throw new Error("as_catalog_query: country.stampworld is required");
  }
  const id = String(country.id ?? "").trim();
  if (!id) {
    throw new Error("as_catalog_query: country.id is required");
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error(`as_catalog_query: invalid country.id: ${id}`);
  }
  const categories = country.categories;
  const periods = country.periods;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("as_catalog_query: country.categories is required");
  }
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new Error("as_catalog_query: country.periods is required");
  }
  return {
    id,
    country: stampworld,
    categories,
    periods,
  };
}

/** Output directory key for a country concept (`id`). */
export function country_id(country) {
  if (typeof country === "string") return country.trim();
  if (country && typeof country === "object") {
    const id = String(country.id ?? "").trim();
    if (id) return id;
  }
  throw new Error("country_id expects a country concept with .id");
}

/**
 * Attach country concept id/stampworld onto a consolidated collection
 * so writers land under output/<id>/.
 */
export function with_country_meta(collection, country) {
  const q = as_catalog_query(country);
  return {
    ...collection,
    id: q.id,
    country: q.country,
  };
}

/**
 * Merge period JSON under output/<id>/ for a loaded country concept.
 * `output_dir` is the root (default `output`).
 */
export function consolidate_country(country, output_dir = "output") {
  const dir = country_output_dir(country_id(country), output_dir);
  return with_country_meta(consolidate_periods(dir), country);
}

export default {
  load_country,
  as_catalog_query,
  country_id,
  with_country_meta,
  consolidate_country,
};
