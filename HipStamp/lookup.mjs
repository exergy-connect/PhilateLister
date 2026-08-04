#!/usr/bin/env node
/**
 * HipStamp listing images via Playwright (Chromium / Chrome).
 *
 * Default: GET the same URL the site uses for search, e.g.
 *   https://www.hipstamp.com/search?keywords=US%20%23156
 *
 * Optional --ui: fill the header field (placeholder "Complete your collection…",
 * id varies e.g. input-188) instead of navigating by keywords.
 *
 * Usage:
 *   npm install && npx playwright install chromium
 *   npm run lookup -- "US #156"
 *   node lookup.mjs --keywords "US #156" --max 5
 *   node lookup.mjs "US #156" --out ./my-images
 *
 * By default, writes urls.txt and downloads each image under HipStamp/downloads/<run>/.
 * If `playwright install chromium` fails on your OS, use a system browser:
 *   PW_CHANNEL=chrome node lookup.mjs "US #156"
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORIGIN = "https://www.hipstamp.com";
const DEFAULT_KEYWORDS = "US #156";

/** @param {string} keywords */
function searchUrl(keywords) {
  const q = new URLSearchParams({ keywords });
  return `${ORIGIN}/search?${q.toString()}`;
}

/** @param {string} s */
function slugKeywords(s) {
  const t = s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return (t || "search").slice(0, 80);
}

function parseArgs(argv) {
  const out = {
    keywords: DEFAULT_KEYWORDS,
    max: 10,
    headless: true,
    timeout: 45_000,
    useUi: false,
    /** @type {string | null} null = default run dir under HipStamp/downloads */
    outDir: null,
    saveFiles: true,
    downloadImages: true,
  };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keywords" || a === "-k" || a === "--query" || a === "-q")
      out.keywords = argv[++i] ?? out.keywords;
    else if (a === "--max" || a === "-n") out.max = Math.max(1, parseInt(argv[++i] ?? "10", 10));
    else if (a === "--headed") out.headless = false;
    else if (a === "--timeout") out.timeout = parseInt(argv[++i] ?? "45000", 10);
    else if (a === "--ui") out.useUi = true;
    else if (a === "--out" || a === "-o") out.outDir = path.resolve(argv[++i] ?? ".");
    else if (a === "--no-save") out.saveFiles = false;
    else if (a === "--urls-only") {
      out.downloadImages = false;
    } else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) rest.push(a);
  }
  if (rest.length) out.keywords = rest.join(" ");
  return out;
}

/** @param {string} imageUrl */
function extFromUrl(imageUrl) {
  try {
    const p = new URL(imageUrl).pathname;
    const m = p.match(/\.(jpe?g|png|webp|gif)$/i);
    return m ? m[0].toLowerCase() : ".jpg";
  } catch {
    return ".jpg";
  }
}

/**
 * @param {string[]} urls
 * @param {string} dir
 * @param {{ download: boolean }} opts
 */
async function writeUrlsAndImages(urls, dir, opts) {
  await fs.mkdir(dir, { recursive: true });
  const listPath = path.join(dir, "urls.txt");
  await fs.writeFile(listPath, urls.join("\n") + "\n", "utf8");
  if (!opts.download) return;

  const ua =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const ext = extFromUrl(u);
    const filePath = path.join(dir, `image-${String(i + 1).padStart(3, "0")}${ext}`);
    const res = await fetch(u, { headers: { "User-Agent": ua } });
    if (!res.ok) throw new Error(`GET ${u} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(filePath, buf);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.error(`Usage: node lookup.mjs [keywords] [options]
  Default navigation: ${ORIGIN}/search?keywords=<encoded>

  --keywords, -k, --query, -q   Search keywords (default: ${DEFAULT_KEYWORDS})
  --max, -n                     Max image URLs to print (default: 10)
  --out, -o DIR                 Output directory (default: HipStamp/downloads/<slug>-<time>/)
  --urls-only                   Write urls.txt only; do not download image bytes
  --no-save                     Print URLs only; do not write files
  --ui                          Use header search input instead of /search?keywords=
  --headed                      Show browser window
  --timeout ms                  Navigation / wait timeout (default: 45000)
`);
    process.exit(0);
  }

  const channel = process.env.PW_CHANNEL?.trim() || undefined;
  const executablePath = process.env.PW_EXECUTABLE?.trim() || undefined;
  const browser = await chromium.launch({
    headless: opts.headless,
    ...(channel ? { channel } : {}),
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout);

  try {
    if (opts.useUi) {
      await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
      const search = page
        .getByPlaceholder(/complete your collection/i)
        .filter({ visible: true })
        .or(page.locator("#input-188").filter({ visible: true }));
      await search.first().waitFor({ state: "visible" });
      await search.first().fill(opts.keywords);
      await search.first().press("Enter");
      await page.waitForURL(/\/(search|browse)\b/i, { timeout: opts.timeout }).catch(() => {});
    } else {
      const url = searchUrl(opts.keywords);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    await page.locator("img.primary").first().waitFor({ state: "visible", timeout: opts.timeout });

    const urls = await page
      .locator("img.primary")
      .evaluateAll((imgs, max) => {
        const seen = new Set();
        const out = [];
        for (const el of imgs) {
          const src = el.getAttribute("src");
          if (!src || seen.has(src)) continue;
          seen.add(src);
          out.push(src);
          if (out.length >= max) break;
        }
        return out;
      }, opts.max);

    if (!urls.length) {
      console.error("No listing images (img.primary) found on the results page.");
      process.exitCode = 1;
      return;
    }

    for (const u of urls) console.log(u);

    if (opts.saveFiles) {
      const runSlug = `${slugKeywords(opts.keywords)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const dir = opts.outDir ?? path.join(__dirname, "downloads", runSlug);
      await writeUrlsAndImages(urls, dir, { download: opts.downloadImages });
      console.error(
        opts.downloadImages
          ? `Wrote ${path.join(dir, "urls.txt")} and ${urls.length} image file(s) under ${dir}`
          : `Wrote ${path.join(dir, "urls.txt")}`
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
