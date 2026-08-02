/**
 * Collect a country catalogue: load period JSON from disk when present,
 * otherwise scrape StampWorld, attach thumbnails, and write the file.
 *
 *   output/<country>/<period>.json
 *
 * Re-fetch with `--with refresh=true` (or CLI `--refresh`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  country_dir,
  country_output_dir,
  scrape_catalogue,
} from "./scrape.js";
import { add_thumbnails } from "./thumbnails.js";

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function wantsRefresh(refreshFlag) {
  if (asBool(refreshFlag, false)) return true;
  return process.argv.includes("--refresh");
}

function periodJsonPath(outputDir, outputId, period) {
  return path.resolve(
    String(outputDir || "output"),
    country_dir(outputId),
    `${period}.json`,
  );
}

function loadPeriodFile(filePath) {
  const doc = JSON.parse(readFileSync(filePath, "utf8"));
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`collect_catalogue: cached period is not an object: ${filePath}`);
  }
  return doc;
}

function writePeriodFile(filePath, doc, outputId, period) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(doc)}\n`, "utf8");
  console.error(`[stamp_collector] wrote ${outputId}/${period}.json`);
}

/**
 * @param {object} query catalog_query: { id, country, categories, periods }
 * @param {unknown} max_pages
 * @param {unknown} delay_ms
 * @param {unknown} year
 * @param {unknown} refresh
 * @param {unknown} output_dir
 */
export function collect_catalogue(
  query,
  max_pages = 0,
  delay_ms = 250,
  year = "",
  refresh = false,
  output_dir = "output",
) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("collect_catalogue expects a catalog_query object");
  }
  const outputId = String(query.id ?? "").trim();
  const stampworld = String(query.country ?? "").trim();
  const periods = Array.isArray(query.periods)
    ? query.periods.map(String).filter((s) => s.trim() !== "")
    : [];
  if (!outputId) throw new Error("collect_catalogue: query.id is required");
  if (!stampworld) throw new Error("collect_catalogue: query.country is required");
  if (periods.length === 0) {
    throw new Error("collect_catalogue: query.periods is required");
  }

  const refreshAll = wantsRefresh(refresh);
  const outRoot = String(output_dir ?? "output").trim() || "output";

  /** @type {Record<string, object>} */
  const byPeriod = {};
  /** @type {string[]} */
  const missing = [];

  for (const period of periods) {
    const filePath = periodJsonPath(outRoot, outputId, period);
    if (!refreshAll && existsSync(filePath)) {
      console.error(`[stamp_collector] load ${outputId}/${period}`);
      byPeriod[period] = loadPeriodFile(filePath);
      continue;
    }
    missing.push(period);
  }

  if (missing.length > 0) {
    console.error(
      `[stamp_collector] fetch ${outputId}: ${missing.length} period(s)${refreshAll ? " (refresh)" : ""}`,
    );
    const scraped = scrape_catalogue(
      { ...query, periods: missing },
      max_pages,
      delay_ms,
      year,
    );
    for (const period of missing) {
      const raw = scraped.periods?.[period];
      if (!raw) {
        throw new Error(`collect_catalogue: scrape produced no data for ${period}`);
      }
      const withThumbs = add_thumbnails(raw);
      const filePath = periodJsonPath(outRoot, outputId, period);
      writePeriodFile(filePath, withThumbs, outputId, period);
      byPeriod[period] = withThumbs;
    }
  }

  return {
    base: scrapedBase(byPeriod) ?? "https://www.stampworld.com",
    id: outputId,
    country: stampworld,
    categories: query.categories,
    fetchedAt: new Date().toISOString(),
    periods: byPeriod,
    output_dir: country_output_dir(outputId, outRoot),
  };
}

function scrapedBase(byPeriod) {
  for (const doc of Object.values(byPeriod)) {
    if (doc && typeof doc.base === "string" && doc.base) return doc.base;
  }
  return null;
}

export default { collect_catalogue };
