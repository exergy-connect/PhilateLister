/**
 * Scrape StampWorld catalogue listings for a catalog_query.
 * Sync (curl) so it can run as a capability `_transform` filter.
 */
import { execFileSync } from "node:child_process";
import { to_catalogue_string } from "../types/catalogue.js";

const BASE = "https://www.stampworld.com";
const UA = "PhilateLister-stamp-collector/1.0 (+https://github.com/exergy-connect)";

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function decodeHtml(s) {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function absUrl(href, fromUrl) {
  if (!href) return null;
  try {
    return new URL(href, fromUrl).href;
  } catch {
    return null;
  }
}

function relPath(href, fromUrl = BASE) {
  const abs = absUrl(href, fromUrl);
  if (!abs) return null;
  try {
    return new URL(abs).pathname;
  } catch {
    return null;
  }
}

function commonDirPrefix(paths) {
  const dirs = paths
    .filter((p) => typeof p === "string" && p.includes("/"))
    .map((p) => p.slice(0, p.lastIndexOf("/") + 1));
  if (dirs.length === 0) return null;
  let prefix = dirs[0];
  for (const d of dirs.slice(1)) {
    while (prefix && !d.startsWith(prefix)) {
      const cut = prefix.lastIndexOf("/", prefix.length - 2);
      prefix = cut >= 0 ? prefix.slice(0, cut + 1) : "";
    }
    if (!prefix) return null;
  }
  return prefix || null;
}

function parseSetMeta(pHtml) {
  const lines = pHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => decodeEntities(l).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  /** @type {Record<string, string>} */
  const meta = {};
  if (lines[0] && !/^(WM|Design|Engraving|Perforation):/i.test(lines[0])) {
    meta.issued = lines[0];
  }
  for (const line of lines) {
    const m = line.match(/^(WM|Design|Engraving|Perforation):\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    meta[key === "wm" ? "watermark" : key] = m[2].replace(/\.$/, "").trim();
  }
  return meta;
}

function parseStampsInGroup(groupHtml, imgByType) {
  const stamps = [];
  const rowRe =
    /<tr[^>]*data-stamp-group-id="[^"]*"[^>]*data-stamp-type="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(groupHtml))) {
    const type = m[1];
    if (!type || type === "-" || type.includes("-")) continue;
    const body = m[2];
    const no = (body.match(/id="a_s_(\d+)"/) || [])[1] || "";
    const tds = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((t) =>
      decodeHtml(t[1].replace(/<[^>]+>/g, " ")),
    );
    const img = imgByType.get(type);
    stamps.push({
      no,
      type,
      denom: tds[1] || "",
      color: tds[3] || "",
      description: tds[5] || "",
      imagePath: img?.imagePath ?? null,
    });
  }
  return stamps;
}

function parsePage(html, pageUrl) {
  const imgByType = new Map();
  for (const m of html.matchAll(
    /src="(\/media\/catalogue\/[^"]+?\/([A-Za-z0-9]+)-s\.jpg)"[^>]*alt="([^"]*)"/gi,
  )) {
    imgByType.set(m[2], { imagePath: relPath(m[1], BASE) });
  }

  const pageMatch = html.match(/page\s+(\d+)\s*\/\s*(\d+)/i);
  const page = pageMatch ? Number(pageMatch[1]) : null;
  const pageTotal = pageMatch ? Number(pageMatch[2]) : null;

  const sets = [];
  const groupRe =
    /<div class="container-fluid content_table" id="group_box_(\d+)">([\s\S]*?)(?=<div class="container-fluid content_table" id="group_box_|\nid="pagination"|$)/gi;
  let gm;
  while ((gm = groupRe.exec(html))) {
    const id = gm[1];
    const body = gm[2];
    const header = body.match(
      /<a href="([^"]+\/(g\d+)\/\/)"[^>]*>\s*(\d{4})\s+([\s\S]*?)\s*<\/a>/i,
    );
    if (!header) continue;
    const ref = header[2];
    const year = Number(header[3]);
    const title = decodeHtml(header[4]);
    const pHtml = (body.match(/<p>([\s\S]*?)<\/p>/i) || [])[1] || "";
    const meta = parseSetMeta(pHtml);
    const stamps = parseStampsInGroup(body, imgByType);
    if (stamps.length === 0) continue;
    sets.push({
      id,
      ref,
      year,
      title,
      ...meta,
      page,
      stamps,
    });
  }

  let nextUrl = null;
  const nextAnchors = [
    ...html.matchAll(
      /<a[^>]*class="[^"]*next_page[^"]*"[^>]*href="([^"]+)"[^>]*>/gi,
    ),
    ...html.matchAll(
      /<a[^>]*href="([^"]+)"[^>]*class="[^"]*next_page[^"]*"[^>]*>/gi,
    ),
  ];
  for (const a of nextAnchors) {
    const href = decodeHtml(a[1]);
    if (/[?&]page=\d+/i.test(href)) {
      nextUrl = absUrl(href, pageUrl);
      break;
    }
  }

  return { sets, page, pageTotal, nextUrl };
}

function fetchHtml(url) {
  return execFileSync(
    "curl",
    ["-sL", "-A", UA, "--fail", "--max-time", "60", url],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
}

function pause(ms) {
  if (!(ms > 0)) return;
  execFileSync("sleep", [(ms / 1000).toFixed(3)], { stdio: "ignore" });
}

function relativizeImages(sets) {
  const paths = sets.flatMap((s) => s.stamps.map((t) => t.imagePath));
  const media = commonDirPrefix(paths);
  const out = sets.map((set) => ({
    ...set,
    stamps: set.stamps.map(({ imagePath, ...rest }) => {
      if (!imagePath) return { ...rest, image: null };
      if (media && imagePath.startsWith(media)) {
        return { ...rest, image: imagePath.slice(media.length) };
      }
      return { ...rest, image: imagePath };
    }),
  }));
  return { media, sets: out };
}

/**
 * @param {string} startUrl
 * @param {{ maxPages: number, delayMs: number, year: number | null }} opts
 */
function scrapePeriod(startUrl, opts) {
  const { maxPages, delayMs, year } = opts;
  const sets = [];
  const pages = [];
  const seenUrls = new Set();
  let url = startUrl;
  let pageCount = 0;

  while (url && !seenUrls.has(url)) {
    if (maxPages > 0 && pageCount >= maxPages) break;
    seenUrls.add(url);
    pageCount += 1;

    const html = fetchHtml(url);
    const parsed = parsePage(html, url);
    const kept = year == null ? parsed.sets : parsed.sets.filter((s) => s.year === year);
    pages.push({
      page: parsed.page,
      pageTotal: parsed.pageTotal,
      setCount: kept.length,
      stampCount: kept.reduce((n, s) => n + s.stamps.length, 0),
    });
    sets.push(...kept);

    if (
      year != null &&
      parsed.sets.length > 0 &&
      parsed.sets.every((s) => s.year > year)
    ) {
      break;
    }
    if (
      year != null &&
      parsed.sets.some((s) => s.year === year) &&
      parsed.sets.some((s) => s.year > year)
    ) {
      break;
    }

    url = parsed.nextUrl;
    if (url && delayMs > 0) pause(delayMs);
  }

  const byId = new Map();
  for (const s of sets) byId.set(s.id, s);
  const uniqueSets = [...byId.values()];
  const { media, sets: setsOut } = relativizeImages(uniqueSets);
  const stampCount = setsOut.reduce((n, s) => n + s.stamps.length, 0);

  return {
    base: BASE,
    source: relPath(startUrl) ?? startUrl,
    ...(media ? { media } : {}),
    ...(year != null ? { year } : {}),
    pageCount: pages.length,
    setCount: setsOut.length,
    stampCount,
    pages,
    sets: setsOut,
  };
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).filter((s) => s.trim() !== "");
  if (value == null || value === "") return [];
  return [String(value)];
}

function asInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} query catalog_query: { country, categories, periods }
 * @param {unknown} max_pages
 * @param {unknown} delay_ms
 * @param {unknown} year
 */
export function scrape_catalogue(query, max_pages = 0, delay_ms = 250, year = "") {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("scrape_catalogue expects a catalog_query object");
  }
  const country = String(query.country ?? "").trim();
  const categories = asList(query.categories);
  const periods = asList(query.periods);
  if (!country) throw new Error("scrape_catalogue: query.country is required");
  if (categories.length === 0) {
    throw new Error("scrape_catalogue: query.categories is required");
  }
  if (periods.length === 0) {
    throw new Error("scrape_catalogue: query.periods is required");
  }

  const yearFilter = String(year ?? "").trim();
  const yearNum = yearFilter === "" ? null : Number(yearFilter);
  if (yearFilter !== "" && !Number.isInteger(yearNum)) {
    throw new Error(`scrape_catalogue: year must be an integer: ${yearFilter}`);
  }

  const opts = {
    maxPages: asInt(max_pages, 0),
    delayMs: asInt(delay_ms, 250),
    year: yearNum,
  };

  /** @type {Record<string, object>} */
  const byPeriod = {};
  for (let pi = 0; pi < periods.length; pi++) {
    const period = periods[pi];
    /** @type {Map<string, object>} */
    const byId = new Map();
    let baseDoc = null;
    for (let ci = 0; ci < categories.length; ci++) {
      const category = categories[ci];
      const url = to_catalogue_string({ country, category, period });
      const doc = scrapePeriod(url, opts);
      baseDoc ??= doc;
      for (const set of doc.sets) byId.set(set.id, set);
      if (ci + 1 < categories.length && opts.delayMs > 0) pause(opts.delayMs);
    }
    const setsOut = [...byId.values()];
    byPeriod[period] = {
      ...baseDoc,
      setCount: setsOut.length,
      stampCount: setsOut.reduce((n, s) => n + s.stamps.length, 0),
      sets: setsOut,
    };
    if (pi + 1 < periods.length && opts.delayMs > 0) pause(opts.delayMs);
  }

  return {
    base: BASE,
    country,
    categories,
    fetchedAt: new Date().toISOString(),
    periods: byPeriod,
  };
}

export default { scrape_catalogue };
