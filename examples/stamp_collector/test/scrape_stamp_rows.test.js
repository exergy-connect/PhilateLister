import assert from "node:assert/strict";
import test from "node:test";
import { parseStampsInGroup } from "../filters/scrape.js";

test("stamp rows retain variant suffix, issued volume, and condition prices", () => {
  const cells = [
    "J1", "4/8Øre", "", "grey/red", "", "25A", "(81300)", "",
    "34.61", "17.31", "46.15", "230", "USD",
  ].map((value) => `<td>${value}</td>`).join("");
  const html = `<tr data-stamp-group-id="12384" data-stamp-type="J1">
    <th><a id="a_s_0040A*">40A*</a></th>${cells}</tr>`;

  assert.deepEqual(parseStampsInGroup(html), [{
    no: "0040A",
    type: "J1",
    denom: "4/8Øre",
    color: "grey/red",
    description: "25A",
    issued_count: 81300,
    prices: { currency: "USD", mnh: 34.61, mint: 17.31, used: 46.15, cover: 230 },
    imagePath: null,
  }]);
});

test("issued volumes expand mill and decimal mill suffixes", () => {
  const row = (issued) => {
    const cells = ["M", "JUL", "", "multicoloured", "", "", issued, "", "5", "", "2", "6", "USD"]
      .map((value) => `<td>${value}</td>`).join("");
    return `<tr data-stamp-group-id="1" data-stamp-type="M"><th><a id="a_s_0013">13</a></th>${cells}</tr>`;
  };
  assert.equal(parseStampsInGroup(row("(9 mill)"))[0].issued_count, 9_000_000);
  assert.equal(parseStampsInGroup(row("(7.5 mill)"))[0].issued_count, 7_500_000);
});
