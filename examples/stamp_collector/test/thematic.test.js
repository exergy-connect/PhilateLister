import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { consolidate_thematic_catalog, load_thematic_catalog } from "../filters/thematic.js";
import { write_collection_xp } from "../filters/write_output.js";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "thematic-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const country of ["alpha", "beta"]) {
    mkdirSync(path.join(root, country));
    writeFileSync(path.join(root, country, "Postage stamps.2000-2009.xx.json"), JSON.stringify({
      base: "https://example.com", media: "/media/", source: `/stamps/${country}/Postage%20stamps/2000-2009`,
      sets: [{ id: "1", ref: "g0001", title: "Ships", stamps: [
        { no: "0001", image: "ship.jpg", catalogs: { custom: ["A1"] } }, { no: "0002" },
      ] }, { id: "2", ref: "g0003", stamps: [{ no: "0003" }] },
      { id: "3", ref: "g0004", stamps: [{ no: "0003" }] }],
    }));
  }
  return root;
}
const entry = (country, no = "0001") => ({ country, category: "Postage stamps", no });
const catalog = (entries) => ({ id: "ships", kind: "thematic", entries });

test("country-qualified selections preserve colliding ids, metadata and catalog numbers", (t) => {
  const root = fixture(t);
  const result = consolidate_thematic_catalog(catalog([entry("alpha"), entry("beta"), entry("alpha", "0002")]), root);
  const period = result.periods["2000-2009"];
  assert.equal(period.setCount, 2);
  assert.equal(period.stampCount, 3);
  assert.notEqual(period.sets[0].id, period.sets[1].id);
  assert.deepEqual(period.sets.map((s) => s.country), ["alpha", "beta"]);
  assert.deepEqual(period.sets[0].stamps[0].catalogs, { custom: ["A1"] });
  assert.equal(period.sets[0].stamps[0].image, "/media/ship.jpg");
  assert.equal(period.sets[0].source_id, "1");
  assert.equal(result.country, undefined);
  write_collection_xp(result, path.join(root, "thematic"));
  const saved = readFileSync(path.join(root, "thematic/ships/collection.xp"), "utf8");
  assert.deepEqual(JSON.parse(saved.slice(8)), result);
});

test("missing, ambiguous and duplicate references are errors", (t) => {
  const root = fixture(t);
  assert.throws(() => consolidate_thematic_catalog(catalog([entry("alpha", "9999")]), root), /not found/);
  assert.throws(() => consolidate_thematic_catalog(catalog([entry("alpha", "0003")]), root), /ambiguous/);
  assert.throws(() => consolidate_thematic_catalog(catalog([entry("alpha"), entry("alpha")]), root), /duplicate/);
  const result = consolidate_thematic_catalog(catalog([{ ...entry("alpha", "0003"), set_ref: "g0004" }]), root);
  assert.equal(result.periods["2000-2009"].sets[0].ref, "g0004");
});

test("validates definitions and safely loads bundled catalogs", () => {
  assert.equal(load_thematic_catalog("ships").entries.length, 2);
  assert.throws(() => load_thematic_catalog("../scott/denmark"), /catalog id/);
  assert.throws(() => consolidate_thematic_catalog(catalog([entry("../alpha")])), /entry country/);
  assert.throws(() => consolidate_thematic_catalog(catalog([entry("alpha", 1)])), /no strings/);
  assert.throws(() => consolidate_thematic_catalog({ id: "ships" }), /entries array/);
});
