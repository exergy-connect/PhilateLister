/**
 * StampWorld catalogue URL ↔ { country, category, period?, page? } (+ _url fields).
 *
 *   /stamps/{country}/{category}/{period}   — period from catalogue enum
 *   /stamps/{country}/{category}            — all years (period omitted)
 *   optional ?page={n}  (page 1 / omitted → no query)
 */

const HOST = "www.stampworld.com";
const ROOT = "stamps";

/** @param {string} s */
function enc(s) {
  // Keep commas in country slugs unescaped (China,-Peoples-Rep.).
  return encodeURIComponent(s).replace(/%2C/gi, ",");
}

/**
 * @typedef {{
 *   scheme: string;
 *   host: string;
 *   path: string[];
 *   query: string;
 *   fragment: string;
 *   href: string;
 *   country: string;
 *   category: string;
 *   period?: string;
 *   page?: number;
 * }} CatalogueSemantic
 */

/**
 * @param {string} authored
 * @returns {CatalogueSemantic}
 */
export function from_catalogue_string(authored) {
  if (typeof authored !== "string" || authored.trim() === "") {
    throw new Error("expected non-empty catalogue URL string");
  }
  let url;
  try {
    url = new URL(authored.trim());
  } catch {
    throw new Error(`invalid catalogue URL: ${authored}`);
  }

  const path = url.pathname
    .split("/")
    .filter((segment, index) => !(index === 0 && segment === ""))
    .map((s) => decodeURIComponent(s));

  // /stamps/{country}/{category}[/{period}]
  if (path.length < 3 || path.length > 4 || path[0] !== ROOT) {
    throw new Error(
      `catalogue URL path must be /stamps/{country}/{category}[/{period}]: ${authored}`,
    );
  }

  const pageRaw = url.searchParams.get("page");
  let page;
  if (pageRaw != null && pageRaw !== "") {
    page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`catalogue page must be a positive integer: ${pageRaw}`);
    }
  }

  const country = path[1];
  const category = path[2];
  const period = path[3]; // undefined when omitted → all years

  /** @type {CatalogueSemantic} */
  const semantic = {
    scheme: url.protocol.replace(/:$/, ""),
    host: url.host,
    path,
    query: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    fragment: url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
    href: "",
    country,
    category,
  };
  if (period) semantic.period = period;
  if (page != null) semantic.page = page;
  semantic.href = to_catalogue_string(semantic);
  return semantic;
}

/**
 * @param {CatalogueSemantic | Record<string, unknown>} value
 * @returns {string}
 */
export function to_catalogue_string(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected catalogue object");
  }

  // Prefer structured fields; fall back to path segments from _url.
  let country = String(value.country ?? "").trim();
  let category = String(value.category ?? "").trim();
  let period = String(value.period ?? "").trim();
  if ((!country || !category) && Array.isArray(value.path)) {
    const p = value.path.map(String);
    if (p[0] === ROOT && p.length >= 3) {
      country ||= p[1];
      category ||= p[2];
      if (!period && p[3]) period = p[3];
    }
  }
  if (!country || !category) {
    throw new Error("catalogue requires country and category");
  }

  let pathname = `/${ROOT}/${enc(country)}/${enc(category)}`;
  if (period) pathname += `/${enc(period)}`;

  const url = new URL(pathname, `https://${HOST}`);

  const page = value.page;
  if (page != null && page !== "" && Number(page) > 1) {
    url.searchParams.set("page", String(Number(page)));
  }

  return url.href;
}
