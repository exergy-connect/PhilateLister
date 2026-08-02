#!/usr/bin/env node
/**
 * Refresh catalogs/*.json from stamp_collector artefacts.
 *
 *   node scripts/build-catalogs.mjs
 *
 * Discovers ../stamp_collector/output/<id>/collection.xp and writes
 * catalogs/<id>.json plus catalogs/countries.json (demo entry kept).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load_collection, to_finder_sets } from "../filters/finder_catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGS = path.join(ROOT, "catalogs");
const COLLECTOR_OUT = path.join(ROOT, "../stamp_collector/output");

/** Prefer short ISO-style ids for known countries; otherwise use folder name. */
const COUNTRY_META = {
  china: { id: "cn", name: "China" },
  iceland: { id: "is", name: "Iceland" },
  denmark: { id: "dk", name: "Denmark" },
  sweden: { id: "se", name: "Sweden" },
};

function metaFor(folder) {
  const known = COUNTRY_META[folder];
  if (known) return known;
  const name = folder.charAt(0).toUpperCase() + folder.slice(1);
  return { id: folder, name };
}

function discoverCollections() {
  if (!fs.existsSync(COLLECTOR_OUT)) return [];
  return fs
    .readdirSync(COLLECTOR_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const folder = d.name;
      const source = path.join(COLLECTOR_OUT, folder, "collection.xp");
      if (!fs.existsSync(source)) return null;
      const { id, name } = metaFor(folder);
      return {
        folder,
        id,
        name,
        source,
        out: path.join(CATALOGS, `${id}.json`),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

fs.mkdirSync(CATALOGS, { recursive: true });

const sources = discoverCollections();
const countries = [];

for (const entry of sources) {
  const collection = load_collection(entry.source);
  const sets = to_finder_sets(collection);
  const categories = [
    ...new Set(sets.map((s) => String(s.category || "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const doc = {
    id: entry.id,
    name: entry.name,
    country: collection.country ?? entry.name,
    categories,
    denominations: collection.summary?.denominations ?? {},
    sets,
  };
  fs.writeFileSync(entry.out, `${JSON.stringify(doc)}\n`, "utf8");
  console.log(
    `wrote ${path.relative(ROOT, entry.out)} (${sets.length} sets, ${categories.length} categories)`,
  );
  countries.push({
    id: entry.id,
    name: entry.name,
    catalog: `${entry.id}.json`,
  });
}

// Keep the hand-maintained demo catalog in the picker when present.
const demoPath = path.join(CATALOGS, "demo.json");
if (fs.existsSync(demoPath)) {
  countries.push({
    id: "cn-demo",
    name: "China (demo)",
    catalog: "demo.json",
  });
}

const defaultId = countries.some((c) => c.id === "cn")
  ? "cn"
  : countries[0]?.id ?? "";

const index = { default: defaultId, countries };
const indexPath = path.join(CATALOGS, "countries.json");
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(
  `wrote ${path.relative(ROOT, indexPath)} (${countries.length} countries)`,
);
