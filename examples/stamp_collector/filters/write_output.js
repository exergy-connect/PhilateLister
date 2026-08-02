/**
 * Write collector artefacts under output/<id>/…
 * (Final-template `_basename` templates are not expanded by xform, so paths
 * are resolved here from collection.id.)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { country_output_dir } from "./scrape.js";
import { category_period_basename } from "./paths.js";

function collectionOutputId(collection) {
  const id = String(collection?.id ?? "").trim();
  if (!id) {
    throw new Error("collection.id is required for output paths");
  }
  return id;
}

/**
 * Write per-category artefacts when `collection.categories_by_period` is present:
 *   output/<id>/<category>.<period>.<code>.json
 * Otherwise writes legacy merged `output/<id>/<period>.json`.
 */
export function write_period_json(collection, output_dir = "output") {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error("write_period_json expects a catalogue collection object");
  }
  const id = collectionOutputId(collection);
  const code = String(collection.code ?? id).trim();
  const byCat = collection.categories_by_period;

  if (byCat && typeof byCat === "object" && !Array.isArray(byCat)) {
    const dir = country_output_dir(id, output_dir);
    mkdirSync(dir, { recursive: true });
    for (const [period, cats] of Object.entries(byCat)) {
      for (const [category, doc] of Object.entries(cats ?? {})) {
        const name = category_period_basename(category, period, code);
        const filePath = path.join(dir, name);
        writeFileSync(filePath, `${JSON.stringify(doc)}\n`, "utf8");
        console.error(`[stamp_collector] wrote ${path.join(id, name)}`);
      }
    }
    return collection;
  }

  const periods = collection.periods;
  if (!periods || typeof periods !== "object" || Array.isArray(periods)) {
    throw new Error("write_period_json: collection.periods is required");
  }

  const dir = country_output_dir(id, output_dir);
  mkdirSync(dir, { recursive: true });
  for (const [period, doc] of Object.entries(periods)) {
    const filePath = path.join(dir, `${period}.json`);
    writeFileSync(filePath, `${JSON.stringify(doc)}\n`, "utf8");
    console.error(`[stamp_collector] wrote ${path.join(id, `${period}.json`)}`);
  }
  return collection;
}

/**
 * Write consolidated collection to `output/<id>/collection.xp`
 * (bare JSON after an empty XP front matter, matching prior artefacts).
 */
export function write_collection_xp(collection, output_dir = "output") {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error("write_collection_xp expects a catalogue collection object");
  }
  const id = collectionOutputId(collection);

  const dir = country_output_dir(id, output_dir);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "collection.xp");
  writeFileSync(filePath, `---\n---\n${JSON.stringify(collection)}\n`, "utf8");
  console.error(`[stamp_collector] wrote ${path.join(id, "collection.xp")}`);
  return collection;
}

export default { write_period_json, write_collection_xp };
