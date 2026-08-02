/**
 * Adapt stamp_collector catalogue → SetFinder stamp_set rows.
 *
 * Collector shape (per set): id, ref, year, title, stamps[{no,denom}], thumbnail?
 * Finder shape: id, name, name_zh, year, denominations, catalog, era, image, note
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">
      <rect width="120" height="160" fill="#d6d3cd"/>
      <text x="60" y="84" text-anchor="middle" fill="#5c574f" font-family="sans-serif" font-size="12">No image</text>
    </svg>`,
  );

export function from_json(value) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") {
    throw new Error("from_json expects a JSON string or object");
  }
  return JSON.parse(value);
}

/** Resolve file:// or relative URI against the SetFinder package root. */
function resolvePackageUri(uri) {
  let p = String(uri ?? "").trim();
  if (!p) return null;
  if (p.startsWith("file://")) {
    const rest = p.slice("file://".length);
    if (rest.startsWith("/")) return rest;
    return path.resolve(PACKAGE_DIR, rest);
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(PACKAGE_DIR, p);
}

/**
 * Load a stamp_collector XP/JSON artefact and return the collection object.
 * Accepts includable XP (`---\\n---\\n{json}`) or bare JSON.
 */
export function load_collection(uri) {
  const filePath = resolvePackageUri(uri);
  if (!filePath) {
    throw new Error("load_collection expects a non-empty file URI");
  }
  const text = fs.readFileSync(filePath, "utf8");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`load_collection: no JSON object in ${filePath}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Resolve finder sets from collector_doc, or `fallback` when the URI is empty.
 *   {{ collector_doc | load_finder_sets(catalog.sets) }}
 */
export function load_finder_sets(uri, fallback = []) {
  if (uri == null || String(uri).trim() === "") {
    return Array.isArray(fallback) ? fallback : [];
  }
  return to_finder_sets(load_collection(uri));
}

/**
 * Comparable face-value key for sorting denominations.
 * Normalizes common units to a major-currency float (yuan / króna / dollar).
 */
function denomValue(denom) {
  const s = String(denom ?? "").trim();
  if (!s) return Number.POSITIVE_INFINITY;

  let m = s.match(/^([\d.]+)\s*元$/u);
  if (m) return Number(m[1]);
  m = s.match(/^([\d.]+)\s*分$/u);
  if (m) return Number(m[1]) / 100;

  // Parcel weight labels (not currency) — after face values
  m = s.match(/^B?([\d.]+)\s*g$/i);
  if (m) return 1e6 + Number(m[1]);

  m = s.match(/^([\d.½¼¾]+)/u);
  if (!m) return Number.POSITIVE_INFINITY;
  const n = Number(
    m[1].replace("½", ".5").replace("¼", ".25").replace("¾", ".75"),
  );
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;

  if (/^\d[\d.½¼¾]*\s*c\b/i.test(s)) return n / 100;
  if (/\$/.test(s)) return n;

  // Icelandic / Nordic: skilling, aur/eyrir (1/100 króna), króna
  // Skilling (pre-decimal): keep as its own band before aurar/króna
  if (/\dSk\b/i.test(s) || /\bSk\b/i.test(s)) return -100 + n;
  if (/kr\s*\/\s*aur/i.test(s)) return n;
  if (/aur\s*\/\s*kr/i.test(s)) return n / 100;
  if (/aur|eyr/i.test(s)) return n / 100;
  if (/kr\b/i.test(s)) return n;

  return n;
}

function uniqueDenoms(stamps) {
  const seen = new Set();
  const out = [];
  for (const stamp of stamps ?? []) {
    const d = String(stamp?.denom ?? "").trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.sort((a, b) => denomValue(a) - denomValue(b));
}

function catalogRange(stamps) {
  const nos = (stamps ?? [])
    .map((s) => String(s?.no ?? "").trim())
    .filter(Boolean);
  if (nos.length === 0) return "";
  if (nos.length === 1) return nos[0];
  return `${nos[0]}–${nos[nos.length - 1]}`;
}

function setNote(set) {
  return [set.issued, set.design && `Design: ${set.design}`, set.perforation && `Perf: ${set.perforation}`]
    .filter(Boolean)
    .join(" · ");
}

/** Pick the lowest-denomination stamp that has an image (then lowest catalogue no.). */
function lowestDenomStamp(stamps) {
  if (!Array.isArray(stamps) || stamps.length === 0) return null;
  const withImage = stamps.filter((s) => s?.image);
  const pool = withImage.length > 0 ? withImage : stamps;
  return [...pool].sort((a, b) => {
    const dv = denomValue(a.denom) - denomValue(b.denom);
    if (dv !== 0) return dv;
    return String(a.no ?? "").localeCompare(String(b.no ?? ""), undefined, {
      numeric: true,
    });
  })[0];
}

/** Resolve a collector stamp image path against collection.base / collection.media. */
function stampImageUrl(collection, stamp) {
  if (!stamp?.image) return null;
  const base = String(collection?.base ?? "").replace(/\/$/, "");
  const media = String(collection?.media ?? "");
  const img = String(stamp.image);
  if (img.startsWith("http") || img.startsWith("/")) {
    return img.startsWith("http") ? img : `${base}${img}`;
  }
  if (!base || !media) return null;
  return `${base}${media}${img}`;
}

/** Map collector sets (or a collection `{ sets }` / `{ periods }`) → finder stamp_set list. */
export function to_finder_sets(input) {
  let collection = null;
  let sets = input;
  if (sets && typeof sets === "object" && !Array.isArray(sets)) {
    if (sets.periods && typeof sets.periods === "object" && !Array.isArray(sets.periods)) {
      const out = [];
      for (const period of Object.values(sets.periods)) {
        if (!period || typeof period !== "object" || !Array.isArray(period.sets)) continue;
        out.push(
          ...to_finder_sets({
            ...period,
            base: period.base ?? sets.base,
            media: period.media ?? sets.media,
          }),
        );
      }
      return out;
    }
    if (Array.isArray(sets.sets)) {
      collection = sets;
      sets = sets.sets;
    }
  }
  if (!Array.isArray(sets)) {
    throw new Error("to_finder_sets expects a list of collector sets");
  }
  return sets.map((set) => {
    const thumb = set.thumbnail || set.image || PLACEHOLDER_IMAGE;
    const full =
      (collection ? stampImageUrl(collection, lowestDenomStamp(set.stamps)) : null) ||
      set.image ||
      null;
    const stamps = Array.isArray(set.stamps)
      ? set.stamps.map((s) => ({
          no: String(s.no ?? ""),
          denom: String(s.denom ?? ""),
          image: stampImageUrl(collection, s),
        }))
      : set.image
        ? [{ no: "", denom: "", image: set.image }]
        : [];
    return {
      id: String(set.ref ?? set.id ?? ""),
      name: String(set.title ?? set.name ?? set.ref ?? set.id ?? ""),
      name_zh: String(set.name_zh ?? ""),
      year: Number(set.year),
      denominations: Array.isArray(set.stamps)
        ? uniqueDenoms(set.stamps)
        : (set.denominations ?? []).map(String),
      catalog: Array.isArray(set.stamps)
        ? catalogRange(set.stamps)
        : String(set.catalog ?? ""),
      era: set.era ?? "prc",
      image: thumb,
      image_full: full && full !== thumb ? full : null,
      stamps,
      note: setNote(set) || String(set.note ?? ""),
    };
  });
}

export function finder_year_min(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 1878;
  const years = sets.map((s) => Number(s.year)).filter(Number.isFinite);
  return years.length ? Math.min(...years) : 1878;
}

export function finder_year_max(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 2024;
  const years = sets
    .map((s) => Number(s.year_end ?? s.year))
    .filter(Number.isFinite);
  return years.length ? Math.max(...years) : 2024;
}

export function finder_denominations(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const set of sets) {
    const denoms = Array.isArray(set.stamps)
      ? uniqueDenoms(set.stamps)
      : (set.denominations ?? []).map(String);
    for (const d of denoms) {
      const s = d.trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out.sort((a, b) => denomValue(a) - denomValue(b));
}

/** Compact filter-control snapshot (also materializes finder_sets for templates). */
export function finder_controls(sets) {
  return {
    denominations: finder_denominations(sets),
  };
}

export default {
  from_json,
  load_collection,
  load_finder_sets,
  to_finder_sets,
  finder_year_min,
  finder_year_max,
  finder_denominations,
  finder_controls,
};
