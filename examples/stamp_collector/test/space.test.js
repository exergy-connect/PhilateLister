import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load_thematic_catalog, consolidate_thematic_catalog } from "../filters/thematic.js";

const output = fileURLToPath(new URL("../output/", import.meta.url));

test("bundled space collection resolves offline and keeps only spaceflight and astronomy stamps", () => {
  const definition = load_thematic_catalog("space");
  const collection = consolidate_thematic_catalog(definition, output);
  const sets = Object.values(collection.periods).flatMap((p) => p.sets);
  const stamps = (country) => sets.filter((s) => s.country === country).flatMap((s) => s.stamps);
  assert.equal(collection.summary.stampCount, definition.entries.length);
  assert.equal(collection.summary.stampCount, 223);
  assert.equal(collection.summary.setCount, 84);
  assert.deepEqual(collection.countries, [
    "armenia", "china", "gambia", "grenada", "iceland", "netherlands", "taiwan", "united-states",
  ]);
  assert.deepEqual(stamps("china").map((s) => s.no).filter((no) => no.startsWith("069")), ["0690"]);
  assert.ok(!stamps("iceland").some((s) => ["1191", "1202"].includes(s.no)));
  assert.deepEqual(
    stamps("grenada").map((s) => s.no).filter((no) => no.startsWith("41")).sort(),
    ["4160", "4164", "4171", "4173"],
  );
  assert.deepEqual(
    stamps("united-states").map((s) => s.no).filter((no) => ["3212", "3259", "3261", "3319", "3329", "3384"].includes(no)).sort(),
    ["3212", "3259", "3261", "3319", "3329", "3384"],
  );
  assert.ok(!sets.some((s) => /Goodnight Moon|Fort Bliss|Ford Bliss|Sun Moon Lake|Moon-shaped Fan/i.test(s.title)));
  assert.ok(sets.every((s) => (s.source_url || s.base)?.startsWith("https://")));
  assert.deepEqual(collection.notes, definition.notes);
  assert.deepEqual(collection.sources, definition.sources);
});
