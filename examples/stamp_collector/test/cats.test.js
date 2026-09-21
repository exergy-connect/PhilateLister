import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load_thematic_catalog, consolidate_thematic_catalog } from "../filters/thematic.js";

const output = fileURLToPath(new URL("../output/", import.meta.url));

test("bundled cats collection resolves offline and keeps only identified cat stamps", () => {
  const definition = load_thematic_catalog("cats");
  const collection = consolidate_thematic_catalog(definition, output);
  const sets = Object.values(collection.periods).flatMap((p) => p.sets);
  const stamps = (country) => sets.filter((s) => s.country === country).flatMap((s) => s.stamps);
  assert.equal(collection.summary.stampCount, definition.entries.length);
  assert.equal(collection.summary.stampCount, 49);
  assert.equal(collection.countries.length, 6);
  assert.deepEqual(stamps("gambia").map((s) => s.no).sort(), [
    "3789", "3790", "3791", "3792", "3793", "3794", "3795", "3796",
    "3797", "3798", "3799", "3800", "3801", "3802", "3803", "3804",
    "3805", "3806",
  ]);
  assert.equal(stamps("grenada").length, 9);
  assert.deepEqual(stamps("iceland").map((s) => s.no).sort(), ["0583", "0737", "0901", "1206"]);
  assert.ok(!stamps("iceland").some((s) => ["0581", "0582", "0902", "1205"].includes(s.no)));
  assert.deepEqual(stamps("taiwan").filter((s) => ["3083", "3084", "3094", "3095"].includes(s.no)).map((s) => s.no).sort(), ["3083", "3084", "3094", "3095"]);
  assert.ok(!sets.some((s) => /Top 40|The Cats \(One Way Wind\)/i.test(s.title) || s.stamps.some((st) => /The Cats/i.test(st.description ?? ""))));
  assert.equal(stamps("netherlands").length, 2);
  assert.ok(sets.find((s) => s.country === "netherlands" && s.ref === "g4328"));
  assert.equal(stamps("china").length, 2);
  assert.ok(sets.every((s) => (s.source_url || s.base)?.startsWith("https://")));
  assert.deepEqual(collection.notes, definition.notes);
  assert.deepEqual(collection.sources, definition.sources);
});
