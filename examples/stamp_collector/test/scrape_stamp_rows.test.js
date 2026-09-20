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

test("sheet image remains on the set rather than duplicated onto six stamps", async () => {
  const { parsePage } = await import('../filters/scrape.js');
  const rows = Array.from({ length: 6 }, (_, i) => `<tr data-stamp-group-id="7" data-stamp-type="A${i}"><th><a id="a_s_${6639+i}">${6639+i}</a></th><td>A${i}</td><td>100$</td></tr>`).join('');
  const html = `<div class="container-fluid content_table" id="group_box_7"><a href="/stamps/Guyana/Postage-stamps/g6639//">2000 Pokemon</a><p>30. October</p><img src="/media/catalogue/Guyana/Postage-stamps/6639-b.jpg">${rows}`;
  const set = parsePage(html, 'https://www.stampworld.com/stamps/Guyana/Postage-stamps/g6639//').sets[0];
  assert.equal(set.sheet_image, 'https://www.stampworld.com/media/catalogue/Guyana/Postage-stamps/6639-b.jpg');
  assert.equal(set.stamps.length, 6);
  assert.ok(set.stamps.every(s => s.imagePath === null));
});
