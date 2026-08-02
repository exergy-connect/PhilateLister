/**
 * Catalogue transforms — parse scrape JSON and attach set thumbnails.
 *
 * `add_thumbnails` fetches the lowest-denomination stamp image in each set,
 * shrinks it with ImageMagick, and stores a JPEG data URI on the set.
 */
import { execFileSync } from "node:child_process";

const UA = "PhilateLister-stamp-collector/1.0 (+https://github.com/exergy-connect)";
const THUMB_GEOM = "64x64>";

/** Parse scrape stdout (or any JSON text) into an object. */
export function from_json(value) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") {
    throw new Error("from_json expects a JSON string or object");
  }
  return JSON.parse(value);
}

/** Pretty-print for --final body emission. */
export function to_pretty_json(value) {
  return `${JSON.stringify(value ?? null, null, 2)}\n`;
}

/**
 * Convert StampWorld denomination strings to a comparable yuan value.
 *   "8分" → 0.08, "1.60元" → 1.6, unknown → +Infinity
 */
export function denomValue(denom) {
  const s = String(denom ?? "").trim();
  let m = s.match(/^([\d.]+)\s*元$/u);
  if (m) return Number(m[1]);
  m = s.match(/^([\d.]+)\s*分$/u);
  if (m) return Number(m[1]) / 100;
  m = s.match(/^([\d.]+)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** Pick the lowest-denomination stamp that has an image (then lowest catalogue no.). */
export function lowestDenomStamp(stamps) {
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

function imageUrl(collection, stamp) {
  if (!stamp?.image) return null;
  const base = String(collection.base ?? "").replace(/\/$/, "");
  const media = String(collection.media ?? "");
  if (stamp.image.startsWith("http") || stamp.image.startsWith("/")) {
    return stamp.image.startsWith("http") ? stamp.image : `${base}${stamp.image}`;
  }
  if (!base || !media) return null;
  return `${base}${media}${stamp.image}`;
}

function fetchThumbnailDataUri(url) {
  const jpg = execFileSync(
    "curl",
    ["-sL", "-A", UA, "--fail", "--max-time", "30", url],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const thumb = execFileSync(
    "convert",
    ["jpg:-", "-thumbnail", THUMB_GEOM, "-strip", "jpeg:-"],
    { input: jpg, maxBuffer: 2 * 1024 * 1024 },
  );
  return `data:image/jpeg;base64,${thumb.toString("base64")}`;
}

/**
 * Add `thumbnail` (small JPEG data URI) to each set from its lowest-denom stamp.
 * Accepts a single period collection (`{ sets }`) or a multi-period scrape
 * (`{ periods: { "1990-1999": { sets }, … } }`).
 * @param {object} collection
 */
export function add_thumbnails(collection) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error("add_thumbnails expects a catalogue collection object");
  }
  if (
    collection.periods &&
    typeof collection.periods === "object" &&
    !Array.isArray(collection.periods)
  ) {
    /** @type {Record<string, object>} */
    const periods = {};
    for (const [period, doc] of Object.entries(collection.periods)) {
      periods[period] = add_thumbnails(doc);
    }
    return { ...collection, periods };
  }
  const sets = Array.isArray(collection.sets) ? collection.sets : [];
  return {
    ...collection,
    sets: sets.map((set) => {
      const stamp = lowestDenomStamp(set.stamps);
      const url = imageUrl(collection, stamp);
      if (!url) return { ...set, thumbnail: null };
      try {
        return { ...set, thumbnail: fetchThumbnailDataUri(url) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[thumbnails] ${set.ref ?? set.id}: ${msg}`);
        return { ...set, thumbnail: null };
      }
    }),
  };
}

export default {
  from_json,
  to_pretty_json,
  denomValue,
  lowestDenomStamp,
  add_thumbnails,
};
