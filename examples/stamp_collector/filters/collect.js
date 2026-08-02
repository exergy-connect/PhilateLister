/**
 * Collect a country catalogue: load category×period JSON from disk when present,
 * otherwise scrape StampWorld, attach thumbnails, and write the file.
 *
 *   output/<id>/<category>.<period>.<code>.json
 *   e.g. output/denmark/Postage stamps.1851-1859.dk.json
 *
 * Re-fetch with `--with refresh=true` (or CLI `--refresh`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  country_output_dir,
  scrape_catalogue,
} from "./scrape.js";
import {
  category_period_path,
  country_code,
} from "./paths.js";
import { add_thumbnails } from "./thumbnails.js";

function pause(ms) {
  const n = Number(ms);
  if (!(n > 0)) return;
  execFileSync("sleep", [(n / 1000).toFixed(3)], { stdio: "ignore" });
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).filter((s) => s.trim() !== "");
  if (value == null || value === "") return [];
  return [String(value)];
}

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

function loadDoc(filePath) {
  const doc = JSON.parse(readFileSync(filePath, "utf8"));
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`collect_catalogue: cached file is not an object: ${filePath}`);
  }
  return doc;
}

function writeDoc(filePath, doc, label) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(doc)}\n`, "utf8");
  console.error(`[stamp_collector] wrote ${label}`);
}

/** Resolve relative images against the category doc media before merging. */
function tagCategorySets(doc) {
  const media = String(doc?.media ?? "");
  const category = String(doc?.category ?? "").trim();
  return (doc?.sets ?? []).map((set) => ({
    ...set,
    ...(category ? { category: set.category || category } : {}),
    ...(media ? { media: set.media || media } : {}),
    stamps: (set.stamps ?? []).map((stamp) => {
      const img = String(stamp.image ?? "").trim();
      if (!img || img.startsWith("http") || img.startsWith("/") || !media) {
        return stamp;
      }
      return { ...stamp, image: `${media}${img}` };
    }),
  }));
}

/** Merge category docs for one period into a single sets list (by set id). */
function mergePeriodCategories(categoryDocs) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  let base = null;
  for (const doc of categoryDocs) {
    if (!doc) continue;
    base ??= doc.base;
    for (const set of tagCategorySets(doc)) {
      if (set?.id != null) byId.set(String(set.id), set);
    }
  }
  const setsOut = [...byId.values()];
  return {
    ...(base ? { base } : {}),
    setCount: setsOut.length,
    stampCount: setsOut.reduce((n, s) => n + (s.stamps?.length ?? 0), 0),
    sets: setsOut,
  };
}

/**
 * @param {object} query catalog_query: { id, code, country, categories, periods }
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
  const code = country_code(query);
  const categories = asList(query.categories);
  const periods = asList(query.periods);
  if (!outputId) throw new Error("collect_catalogue: query.id is required");
  if (!stampworld) throw new Error("collect_catalogue: query.country is required");
  if (categories.length === 0) {
    throw new Error("collect_catalogue: query.categories is required");
  }
  if (periods.length === 0) {
    throw new Error("collect_catalogue: query.periods is required");
  }

  const refreshAll = wantsRefresh(refresh);
  const outRoot = String(output_dir ?? "output").trim() || "output";

  /** @type {Record<string, Record<string, object>>} */
  const byPeriodCategory = {};
  /** @type {{ period: string, category: string }[]} */
  const missing = [];

  for (const period of periods) {
    byPeriodCategory[period] ??= {};
    for (const category of categories) {
      const filePath = category_period_path(
        outRoot,
        outputId,
        category,
        period,
        code,
      );
      const label = `${outputId}/${path.basename(filePath)}`;
      if (!refreshAll && existsSync(filePath)) {
        console.error(`[stamp_collector] load ${label}`);
        byPeriodCategory[period][category] = loadDoc(filePath);
        continue;
      }
      missing.push({ period, category });
    }
  }

  if (missing.length > 0) {
    console.error(
      `[stamp_collector] fetch ${outputId}: ${missing.length} categor${missing.length === 1 ? "y" : "ies"}${refreshAll ? " (refresh)" : ""}`,
    );
    for (let i = 0; i < missing.length; i++) {
      const { period, category } = missing[i];
      const scraped = scrape_catalogue(
        {
          id: outputId,
          country: stampworld,
          categories: [category],
          periods: [period],
        },
        max_pages,
        delay_ms,
        year,
      );
      const raw = scraped.periods?.[period];
      if (!raw) {
        throw new Error(
          `collect_catalogue: scrape produced no data for ${category}/${period}`,
        );
      }
      const withThumbs = add_thumbnails({
        ...raw,
        category,
        period,
        code,
      });
      const filePath = category_period_path(
        outRoot,
        outputId,
        category,
        period,
        code,
      );
      writeDoc(filePath, withThumbs, `${outputId}/${path.basename(filePath)}`);
      byPeriodCategory[period] ??= {};
      byPeriodCategory[period][category] = withThumbs;
      if (i + 1 < missing.length) pause(delay_ms);
    }
  }

  /** @type {Record<string, object>} */
  const byPeriod = {};
  for (const period of periods) {
    const cats = byPeriodCategory[period] ?? {};
    byPeriod[period] = mergePeriodCategories(Object.values(cats));
  }

  return {
    base: scrapedBase(byPeriod) ?? "https://www.stampworld.com",
    id: outputId,
    code,
    country: stampworld,
    categories,
    fetchedAt: new Date().toISOString(),
    periods: byPeriod,
    categories_by_period: byPeriodCategory,
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
