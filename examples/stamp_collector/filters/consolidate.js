/**
 * Merge catalogue JSON files into one collection.
 *
 * Prefers per-category artefacts:
 *   <category>.<period>.<code>.json
 * and still accepts legacy merged period files:
 *   <period>.json
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  CATEGORY_PERIOD_FILE,
  LEGACY_PERIOD_FILE,
  parse_category_period_filename,
} from "./paths.js";
import { normalize_denomination, order_denominations } from "./denominations.js";
import { normalize_perforation } from "./perforations.js";
import {
  apply_catalog_crosswalk,
  load_catalog_crosswalk,
} from "./catalog_crosswalks.js";

function listCatalogueFiles(dir) {
  return readdirSync(dir)
    .filter(
      (name) => CATEGORY_PERIOD_FILE.test(name) || LEGACY_PERIOD_FILE.test(name),
    )
    .map((name) => path.join(dir, name))
    .filter((filePath) => statSync(filePath).isFile());
}

function categoryFromSource(source) {
  const parts = String(source ?? "")
    .split("/")
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .filter(Boolean);
  // /stamps/{country}/{category}/{period}
  if (parts[0] === "stamps" && parts[2]) return parts[2];
  return "";
}

/** Resolve relative stamp images against this category doc's media prefix. */
function resolveStampImage(doc, image) {
  const img = String(image ?? "").trim();
  if (!img) return img;
  if (img.startsWith("http") || img.startsWith("/")) return img;
  const media = String(doc.media ?? "");
  if (!media) return img;
  return `${media}${img}`;
}

function tagSets(doc, category) {
  const cat = String(
    category || doc.category || categoryFromSource(doc.source) || "",
  ).trim();
  const media = String(doc.media ?? "");
  return (doc.sets ?? []).map((set) => ({
    ...set,
    ...(cat ? { category: set.category || cat } : {}),
    ...(media ? { media: set.media || media } : {}),
    stamps: (set.stamps ?? []).map((stamp) => ({
      ...stamp,
      image: resolveStampImage(doc, stamp.image),
    })),
  }));
}

function mergeSets(periods, period, doc, category) {
  const tagged = tagSets(doc, category);
  const existing = periods[period];
  if (!existing) {
    periods[period] = {
      base: doc.base,
      sets: tagged,
      setCount: tagged.length,
      stampCount: tagged.reduce((n, s) => n + (s.stamps?.length ?? 0), 0),
    };
    return;
  }
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const set of existing.sets ?? []) {
    if (set?.id != null) byId.set(String(set.id), set);
  }
  for (const set of tagged) {
    if (set?.id != null) byId.set(String(set.id), set);
  }
  const sets = [...byId.values()];
  // Do not keep a single period-level media/source — sets carry their own media.
  periods[period] = {
    base: existing.base ?? doc.base,
    sets,
    setCount: sets.length,
    stampCount: sets.reduce((n, s) => n + (s.stamps?.length ?? 0), 0),
  };
}

/** Rewrite stamp denoms in place using the country normalizer (if any). */
function normalizePeriodDenominations(periods, countryCode) {
  for (const period of Object.values(periods)) {
    for (const set of period?.sets ?? []) {
      for (const stamp of set?.stamps ?? []) {
        if (stamp?.denom == null) continue;
        stamp.denom = normalize_denomination(countryCode, stamp.denom);
      }
    }
  }
}

/** Rewrite set-level perforation details into a stable catalog representation. */
function normalizePeriodPerforations(periods) {
  for (const period of Object.values(periods)) {
    for (const set of period?.sets ?? []) {
      if (set?.perforation == null) continue;
      const perforation = normalize_perforation(set.perforation);
      if (perforation) set.perforation = perforation;
      else delete set.perforation;
    }
  }
}

/** Collect unique denomination strings for collection-level filtering. */
function summarizeDenominations(periods, countryCode, denominationModel = {}) {
  const groups = {
    regular: new Set(),
    surcharges: new Set(),
    overprints: new Set(),
    special: new Set(),
  };
  const special = new Set(
    (denominationModel.special ?? []).map((d) =>
      normalize_denomination(countryCode, d),
    ),
  );

  for (const period of Object.values(periods)) {
    for (const set of period?.sets ?? []) {
      for (const stamp of set?.stamps ?? []) {
        const denomination = normalize_denomination(
          countryCode,
          stamp?.denom,
        );
        if (!denomination) continue;
        if (special.has(denomination)) groups.special.add(denomination);
        // A slash takes precedence when a combined surcharge/overprint has both.
        else if (denomination.includes("/")) groups.overprints.add(denomination);
        else if (denomination.includes("+")) groups.surcharges.add(denomination);
        else groups.regular.add(denomination);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(groups).map(([name, denominations]) => [
      name,
      order_denominations(countryCode, denominations),
    ]),
  );
}

/**
 * Load and merge catalogue JSON from a country output directory (or path list).
 * @param {string | string[]} dirOrPaths
 * @param {object} [denominationModel]
 * @returns {object} collection with `.periods` keyed by period id
 */
export function consolidate_periods(dirOrPaths, denominationModel = {}) {
  /** @type {string[]} */
  let list;
  if (Array.isArray(dirOrPaths)) {
    list = dirOrPaths.map(String);
  } else {
    const dir = String(dirOrPaths ?? "output");
    list = listCatalogueFiles(dir);
  }

  /** @type {Record<string, object>} */
  const periods = {};
  let stampworld;
  let base;
  let countryDir;
  let code;

  for (const filePath of list) {
    const name = path.basename(filePath);
    const parsed = parse_category_period_filename(name);
    const legacy = name.match(LEGACY_PERIOD_FILE);
    if (!parsed && !legacy) continue;

    const period = parsed?.period ?? legacy[1];
    const doc = JSON.parse(readFileSync(filePath, "utf8"));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error(`consolidate_periods: expected object in ${name}`);
    }
    mergeSets(periods, period, doc, parsed?.category ?? doc.category);
    base ??= doc.base;
    code ??= parsed?.code ?? doc.code;
    countryDir ??= path.basename(path.dirname(path.resolve(filePath)));
    if (!stampworld && typeof doc.source === "string") {
      const parts = doc.source.split("/").filter(Boolean);
      if (parts[0] === "stamps" && parts[1]) {
        stampworld = decodeURIComponent(parts[1]);
      }
    }
  }

  const keys = Object.keys(periods).sort();
  if (keys.length === 0) {
    throw new Error(
      "consolidate_periods: no catalogue JSON files (expected <category>.<period>.<code>.json)",
    );
  }

  stampworld ??= countryDir && countryDir !== "output" && countryDir !== "."
    ? countryDir
    : undefined;

  normalizePeriodDenominations(periods, code);
  normalizePeriodPerforations(periods);
  apply_catalog_crosswalk(
    periods,
    "scott",
    load_catalog_crosswalk("scott", countryDir),
  );

  return {
    ...(base ? { base } : {}),
    ...(stampworld ? { country: stampworld } : {}),
    ...(code ? { code } : {}),
    summary: {
      denominations: summarizeDenominations(periods, code, denominationModel),
    },
    periods: Object.fromEntries(keys.map((k) => [k, periods[k]])),
  };
}

export default { consolidate_periods };
