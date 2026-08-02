/**
 * Catalogue artefact paths:
 *   output/<id>/<category>.<period>.<code>.json
 *
 * Example: output/denmark/Postage stamps.1851-1859.dk.json
 */
import path from "node:path";
import { country_dir, country_output_dir } from "./scrape.js";

const PERIOD = "(\\d{4}-\\d{4})";
const CODE = "([A-Za-z0-9_-]+)";
/** Parse `<category>.<period>.<code>.json` (category may contain spaces). */
export const CATEGORY_PERIOD_FILE = new RegExp(
  `^(.+)\\.${PERIOD}\\.${CODE}\\.json$`,
);
/** Legacy merged period file: `YYYY-YYYY.json`. */
export const LEGACY_PERIOD_FILE = new RegExp(`^${PERIOD}\\.json$`);

export function country_code(queryOrCountry) {
  if (typeof queryOrCountry === "string") return queryOrCountry.trim();
  const code = String(queryOrCountry?.code ?? queryOrCountry?.id ?? "").trim();
  if (!code) throw new Error("country code is required");
  if (code.includes("..") || code.includes("/") || code.includes("\\")) {
    throw new Error(`invalid country code: ${code}`);
  }
  return code;
}

/** Sanitize category for use as a path segment (no separators). */
export function category_file_token(category) {
  const s = String(category ?? "").trim();
  if (!s) throw new Error("category is required");
  if (s.includes("..") || s.includes("/") || s.includes("\\")) {
    throw new Error(`invalid category for filename: ${s}`);
  }
  return s;
}

export function category_period_basename(category, period, code) {
  return `${category_file_token(category)}.${period}.${country_code(code)}.json`;
}

export function category_period_path(outputDir, outputId, category, period, code) {
  return path.resolve(
    country_output_dir(outputId, outputDir),
    category_period_basename(category, period, code),
  );
}

export function parse_category_period_filename(name) {
  const m = String(name ?? "").match(CATEGORY_PERIOD_FILE);
  if (!m) return null;
  return { category: m[1], period: m[2], code: m[3] };
}

export { country_dir, country_output_dir };

export default {
  CATEGORY_PERIOD_FILE,
  LEGACY_PERIOD_FILE,
  country_code,
  category_file_token,
  category_period_basename,
  category_period_path,
  parse_category_period_filename,
  country_dir,
  country_output_dir,
};
