import assert from "node:assert/strict";
import test from "node:test";
import {
  apply_catalog_crosswalk,
  load_catalog_crosswalk,
} from "../filters/catalog_crosswalks.js";

test("loads country crosswalks and enriches matching StampWorld stamps", () => {
  const periods = {
    "1870-1879": {
      sets: [{
        category: "Postage stamps",
        stamps: [{ no: "0001" }, { no: "0002" }, { no: "0016a" }, { no: "0020" }, { no: "0021" }],
      }],
    },
  };
  apply_catalog_crosswalk(periods, "scott", load_catalog_crosswalk("scott", "denmark"));
  assert.deepEqual(
    periods["1870-1879"].sets[0].stamps.map((stamp) => stamp.catalogs.scott),
    [["2"], ["1"], ["16"], ["20"], ["24"]],
  );
});

test("supports one-to-many catalog mappings", () => {
  const periods = {
    p: { sets: [{ category: "Postage stamps", stamps: [{ no: "1" }] }] },
  };
  apply_catalog_crosswalk(periods, "scott", {
    mappings: { "Postage stamps::1": { numbers: ["1", "1a"] } },
  });
  assert.deepEqual(periods.p.sets[0].stamps[0].catalogs.scott, ["1", "1a"]);
});

test("set-specific mappings disambiguate reused StampWorld ids", () => {
  const periods = {
    p: { sets: [
      { category: "Postage stamps", ref: "g0001", stamps: [{ no: "0001" }] },
      { category: "Postage stamps", ref: "g01", stamps: [{ no: "0001" }] },
    ] },
  };
  apply_catalog_crosswalk(periods, "scott", {
    mappings: {
      "Postage stamps::g0001::0001": { number: "1" },
      "Postage stamps::g01::0001": { number: "O1" },
    },
  });
  assert.deepEqual(
    periods.p.sets.map((set) => set.stamps[0].catalogs.scott),
    [["1"], ["O1"]],
  );
});
