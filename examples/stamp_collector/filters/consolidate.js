/**
 * Merge per-period catalogue JSON files into one collection.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PERIOD_FILE = /^(\d{4}-\d{4})\.json$/;

/**
 * Load and merge `YYYY-YYYY.json` files from a directory (or an explicit path list).
 * @param {string | string[]} dirOrPaths  Directory path, or list of file paths
 * @returns {object} collection with `.periods` keyed by period id
 */
export function consolidate_periods(dirOrPaths) {
  /** @type {string[]} */
  let list;
  if (Array.isArray(dirOrPaths)) {
    list = dirOrPaths.map(String);
  } else {
    const dir = String(dirOrPaths ?? "output");
    list = readdirSync(dir)
      .filter((name) => PERIOD_FILE.test(name))
      .map((name) => path.join(dir, name));
  }

  /** @type {Record<string, object>} */
  const periods = {};
  let country;
  let base;

  for (const filePath of list) {
    const name = path.basename(filePath);
    const m = name.match(PERIOD_FILE);
    if (!m) continue;
    const period = m[1];
    const doc = JSON.parse(readFileSync(filePath, "utf8"));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error(`consolidate_periods: expected object in ${name}`);
    }
    periods[period] = doc;
    base ??= doc.base;
    if (!country && typeof doc.source === "string") {
      const parts = doc.source.split("/").filter(Boolean);
      if (parts[0] === "stamps" && parts[1]) {
        country = decodeURIComponent(parts[1]);
      }
    }
  }

  const keys = Object.keys(periods).sort();
  if (keys.length === 0) {
    throw new Error(
      "consolidate_periods: no period JSON files (expected names like 1990-1999.json)",
    );
  }

  return {
    ...(base ? { base } : {}),
    ...(country ? { country } : {}),
    periods: Object.fromEntries(keys.map((k) => [k, periods[k]])),
  };
}

export default { consolidate_periods };
