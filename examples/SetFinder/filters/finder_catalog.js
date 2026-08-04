/**
 * Adapt stamp_collector catalogue → SetFinder stamp_set rows.
 *
 * Collector shape (per set): id, ref, year, title, stamps[{no,denom}], thumbnail?
 * Finder shape: id, name, name_zh, year, denominations, catalog, era, image, note
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

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

function safeSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
    throw new Error(`Invalid ${label}`);
  }
  return segment;
}

function imageType(body) {
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (/^GIF8[79]a$/.test(body.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Persist an image and update its stamp entry in the selected country catalogue. */
function persistImage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Image upload expects an object");
  }
  const country = safeSegment(input.country, "country code").toLowerCase();
  const catalog = safeSegment(input.catalog, "catalog number");
  const setId = String(input.set ?? "");
  const stampIndex = Number(input.index);
  if (!Number.isInteger(stampIndex) || stampIndex < 0) throw new Error("Invalid stamp index");

  const catalogPath = path.join(PACKAGE_DIR, "catalogs", `${country}.json`);
  const doc = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const sets = Array.isArray(doc) ? doc : doc.sets;
  const set = sets?.find((entry) => String(entry.id ?? "") === setId);
  const stamp = set?.stamps?.[stampIndex];
  if (!stamp) throw new Error("Catalog entry was not found in the selected set");
  let inheritedCatalog = "";
  for (let index = 0; index <= stampIndex; index += 1) {
    inheritedCatalog = String(set.stamps[index]?.no || inheritedCatalog).trim();
  }
  if (inheritedCatalog !== catalog) {
    throw new Error("Catalog entry does not match the selected stamp");
  }

  let body;
  if (input.data) {
    body = Buffer.from(String(input.data), "base64");
  } else if (input.url) {
    const source = new URL(String(input.url));
    if (!/^https?:$/.test(source.protocol)) throw new Error("Image URL must use HTTP or HTTPS");
    body = execFileSync("curl", ["-fsSL", "--max-filesize", String(MAX_IMAGE_BYTES), source.href], {
      encoding: "buffer",
      maxBuffer: MAX_IMAGE_BYTES + 1,
      timeout: 30_000,
    });
  } else {
    throw new Error("Provide image data or an image URL");
  }
  if (!body.length) throw new Error("The uploaded image is empty");
  if (body.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 20 MB");
  const detectedType = imageType(body);
  if (!detectedType) throw new Error("Use a JPEG, PNG, WebP, or GIF image");
  const declaredType = String(input.content_type ?? "").toLowerCase();
  if (declaredType && declaredType !== detectedType) {
    throw new Error("File contents do not match the selected image type");
  }

  const filename = `${catalog}${IMAGE_TYPES.get(detectedType)}`;
  const imageDir = path.join(PACKAGE_DIR, "images", country);
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, filename), body);
  const relativeUrl = `images/${country}/${filename}`;
  stamp.image = relativeUrl;
  fs.writeFileSync(catalogPath, `${JSON.stringify(doc)}\n`, "utf8");
  return { path: relativeUrl, url: relativeUrl };
}

export function upload_image(input) {
  try {
    return persistImage(input);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
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

function uniqueDenoms(stamps) {
  const seen = new Set();
  const out = [];
  for (const stamp of stamps ?? []) {
    const d = String(stamp?.denom ?? "").trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
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
    return String(a.no ?? "").localeCompare(String(b.no ?? ""), undefined, {
      numeric: true,
    });
  })[0];
}

/**
 * Resolve a collector stamp image path against set.media (preferred) or
 * collection.media — needed when multiple StampWorld categories share a period.
 */
function stampImageUrl(collection, stamp, set = null) {
  if (!stamp?.image) return null;
  const base = String(collection?.base ?? "").replace(/\/$/, "");
  const media = String(set?.media ?? collection?.media ?? "");
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
    const category = String(
      set.category ?? collection?.category ?? categoryFromSource(collection?.source) ?? "",
    ).trim();
    const thumb = set.thumbnail || set.image || PLACEHOLDER_IMAGE;
    const full =
      (collection
        ? stampImageUrl(collection, lowestDenomStamp(set.stamps), set)
        : null) ||
      set.image ||
      null;
    const stamps = Array.isArray(set.stamps)
      ? set.stamps.map((s) => ({
          no: String(s.no ?? ""),
          denom: String(s.denom ?? ""),
          image: stampImageUrl(collection, s, set),
          ...(s.catalogs && typeof s.catalogs === "object" && Object.keys(s.catalogs).length
            ? { catalogs: s.catalogs }
            : {}),
          issued_count: Number.isFinite(Number(s.issued_count)) ? Number(s.issued_count) : null,
          prices: s.prices && typeof s.prices === "object" ? s.prices : null,
        }))
      : set.image
        ? [{ no: "", denom: "", image: set.image }]
        : [];
    const ref = String(set.ref ?? set.id ?? "");
    // StampWorld reuses g0001-style refs per category — namespace when needed.
    const id = category && set.ref ? `${set.ref}::${category}` : ref;
    const perforation = String(set.perforation ?? "").trim();
    return {
      id,
      name: String(set.title ?? set.name ?? set.ref ?? set.id ?? ""),
      name_zh: String(set.name_zh ?? ""),
      year: Number(set.year),
      denominations: Array.isArray(set.stamps)
        ? uniqueDenoms(set.stamps)
        : (set.denominations ?? []).map(String),
      catalog: Array.isArray(set.stamps)
        ? catalogRange(set.stamps)
        : String(set.catalog ?? ""),
      category,
      era: set.era || category || "prc",
      image: thumb,
      image_full: full && full !== thumb ? full : null,
      ...(perforation ? { perforation } : {}),
      stamps,
      note: setNote(set) || String(set.note ?? ""),
    };
  });
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
  if (parts[0] === "stamps" && parts[2]) return parts[2];
  return "";
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
  return out;
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
