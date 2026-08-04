/** Normalize scraped set-level perforation descriptions for downstream catalogs. */
export function normalize_perforation(perforation) {
  let value = String(perforation ?? "").trim();
  if (!value) return "";

  value = value
    .replace(/^perf(?:oration)?\.?\s*:?\s*/i, "")
    .replace(/[×✕]/g, "x")
    .replace(/\s*[xX]\s*/g, " x ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (/^imperf(?:orate|orated)?\.?$/i.test(value)) return "Imperforated";
  if (/^die[ -]?cut$/i.test(value)) return "Die Cut";
  if (/^rouletted?\b/i.test(value)) {
    return value.replace(/^rouletted?/i, "Rouletted");
  }
  return value;
}

export default { normalize_perforation };
