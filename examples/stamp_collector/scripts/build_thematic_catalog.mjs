import path from "node:path";
import { fileURLToPath } from "node:url";
import { load_thematic_catalog, consolidate_thematic_catalog } from "../filters/thematic.js";
import { write_collection_xp } from "../filters/write_output.js";

const [id, outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output")] = process.argv.slice(2);
if (!id) {
  console.error("usage: node scripts/build_thematic_catalog.mjs <catalog-id> [output-dir]");
  process.exitCode = 1;
} else {
  const collection = consolidate_thematic_catalog(load_thematic_catalog(id), outputDir);
  write_collection_xp(collection, path.join(outputDir, "thematic"));
}
