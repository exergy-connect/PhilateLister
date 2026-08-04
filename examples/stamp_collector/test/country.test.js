import assert from "node:assert/strict";
import test from "node:test";
import { as_catalog_query, country_id } from "../filters/country.js";

const china = {
  _id: "china",
  code: "cn",
  stampworld: "China,-Peoples-Rep.",
  categories: ["Postage stamps"],
  periods: ["1949-1949"],
};

test("country adapters use xForm-derived _id", () => {
  assert.equal(country_id(china), "china");
  assert.deepEqual(as_catalog_query(china), {
    id: "china",
    code: "cn",
    country: "China,-Peoples-Rep.",
    categories: ["Postage stamps"],
    periods: ["1949-1949"],
  });
});

test("country adapters accept template name when _id is absent", () => {
  assert.equal(
    country_id({
      name: "china",
      stampworld: "China,-Peoples-Rep.",
      categories: ["Postage stamps"],
      periods: ["1949-1949"],
      code: "cn",
    }),
    "china",
  );
});

test("country adapters do not accept an authored id", () => {
  assert.throws(
    () => country_id({ id: "china" }),
    /country concept with \._id or \.name/,
  );
});
