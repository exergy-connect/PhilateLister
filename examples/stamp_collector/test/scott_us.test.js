import assert from "node:assert/strict";
import test from "node:test";
import { apply_catalog_crosswalk, load_catalog_crosswalk } from "../filters/catalog_crosswalks.js";

const crosswalk = load_catalog_crosswalk("scott", "united-states");

test("US categories disambiguate identical StampWorld numbers", () => {
  const categories = ["Postage stamps", "Airmail stamps", "Airmail delivery stamps",
    "Official stamps", "Postal Note stamps", "Parcel post stamps"];
  const periods = { p: { sets: categories.map(category => ({
    category, ref: "g0001", stamps: [{ no: "0001" }],
  })) } };
  apply_catalog_crosswalk(periods, "scott", crosswalk);
  assert.deepEqual(periods.p.sets.map(s => s.stamps[0].catalogs.scott),
    [["1"], ["C1"], ["CE1"], ["O1"], ["PN1"], ["Q1"]]);
});

test("US crosswalk preserves suffixes and the officials numbering gap", () => {
  const periods = { p: { sets: [
    { category: "Postage stamps", ref: "g0484", stamps: [{ no: "0484" }, { no: "0484a" }, { no: "0484A" }] },
    { category: "Postage stamps", ref: "g5815i", stamps: [{ no: "5815i" }] },
    { category: "Official stamps", ref: "g0046", stamps: [{ no: "0046" }] },
    { category: "Airmail stamps", ref: "g0033", stamps: [{ no: "0033" }, { no: "0033A" }] },
  ] } };
  apply_catalog_crosswalk(periods, "scott", crosswalk);
  const [freedom, ptsd, official, airmail] = periods.p.sets;
  assert.deepEqual(freedom.stamps.map(s => s.catalogs?.scott), [["573"], ["573a"], undefined]);
  assert.deepEqual(ptsd.stamps[0].catalogs.scott, ["B7"]);
  assert.deepEqual(official.stamps[0].catalogs.scott, ["O47"]);
  assert.deepEqual(airmail.stamps.map(s => s.catalogs.scott), [["C33"], ["C37"]]);
});

test("2026 issue ranges and sheets do not manufacture component identities", () => {
  const periods = { p: { sets: [
    { category: "Postage stamps", ref: "g6503", stamps: [{ no: "6503" }, { no: "6504" }] },
    { category: "Postage stamps", ref: "g6582", stamps: [{ no: "6582" }, { no: "6583" }] },
    { category: "Postage stamps", ref: "g6641", stamps: [{ no: "6641" }] },
    { category: "Postage stamps", ref: "g9999", stamps: [{ no: "9999" }] },
  ] } };
  apply_catalog_crosswalk(periods, "scott", crosswalk);
  const [love, icons, kwanzaa, unknown] = periods.p.sets;
  assert.deepEqual(love.catalogs.scott, ["6046-6049"]);
  assert.equal(love.catalog_details.scott.relation, "set");
  assert.deepEqual(icons.catalogs.scott, ["6106"]);
  assert.equal(icons.catalog_details.scott.relation, "sheet");
  assert.ok([...love.stamps, ...icons.stamps, ...unknown.stamps].every(s => s.catalogs === undefined));
  assert.deepEqual(kwanzaa.stamps[0].catalogs.scott, ["6123"]);
  assert.equal(crosswalk.coverage.complete, false);
});
