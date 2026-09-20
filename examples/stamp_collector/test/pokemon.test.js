import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load_thematic_catalog, consolidate_thematic_catalog } from "../filters/thematic.js";

const output = fileURLToPath(new URL("../output/", import.meta.url));

test("bundled Pokémon collection resolves offline with verified sheet references", () => {
  const definition = load_thematic_catalog("pokemon");
  const collection = consolidate_thematic_catalog(definition, output);
  const sets = Object.values(collection.periods).flatMap((p) => p.sets);
  assert.equal(collection.summary.stampCount, definition.entries.length);
  assert.equal(collection.summary.stampCount, 143);
  assert.equal(collection.countries.length, 12);
  const numbers = (country) => sets.filter((s) => s.country === country).flatMap((s) => s.catalogs?.scott ?? []);
  assert.deepEqual(numbers("gambia").sort(), ["2393", "2394"]);
  assert.deepEqual(numbers("grenada").sort(), ["3088", "3089", "3269", "3270"]);
  const sheet = sets.find((s) => s.country === "gambia" && s.ref === "g4227");
  assert.equal(sheet.stamps.length, 6);
  assert.ok(sheet.stamps.every((s) => !s.catalogs?.scott));
  const souvenir = sets.find((s) => s.country === "gambia" && s.ref === "g4233");
  assert.deepEqual(souvenir.stamps[0].catalogs.scott, ["2394"]);
  assert.equal(sets.filter((s) => s.country === "japan" && s.year === 2021).flatMap((s) => s.stamps).length, 30);
  assert.equal(sets.filter((s) => s.country === "france").flatMap((s) => s.stamps).length, 17);
  const japanBox = sets.find((s) => s.ref === "jp-2021-box");
  assert.equal(japanBox.base, "https://www.post.japanpost.jp");
  assert.ok(japanBox.stamps.every((s) => s.numbering_system === "local" && !s.catalogs?.stampworld));
  assert.ok(sets.every((s) => s.source_url?.startsWith("https://")));
  assert.deepEqual(collection.notes, definition.notes);
  assert.deepEqual(collection.sources, definition.sources);
});
