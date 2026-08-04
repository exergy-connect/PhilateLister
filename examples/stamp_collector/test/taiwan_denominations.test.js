import assert from "node:assert/strict";
import test from "node:test";
import {
  normalize_denomination,
  order_denominations,
} from "../filters/denominations.js";

test("Taiwan collapses .00, ($), and (C) onto dollar labels", () => {
  assert.equal(normalize_denomination("tw", "1($)"), "1$");
  assert.equal(normalize_denomination("tw", "1$"), "1$");
  assert.equal(normalize_denomination("tw", "2.00($)"), "2$");
  assert.equal(normalize_denomination("tw", "2($)"), "2$");
  assert.equal(normalize_denomination("tw", "2.00$"), "2$");
  assert.equal(normalize_denomination("tw", "0.50($)"), "0.50$");
  assert.equal(normalize_denomination("tw", "20(C)"), "0.20$");
  assert.equal(normalize_denomination("tw", "3(C)"), "0.03$");
  assert.equal(normalize_denomination("tw", "70(C)"), "0.70$");
  assert.equal(normalize_denomination("tw", "100(C)"), "1$");
  assert.equal(normalize_denomination("tw", "0.40+0.10 $"), "0.40+0.10 $");
  assert.equal(normalize_denomination("tw", "5.00+1.00 $"), "5+1 $");
  assert.equal(normalize_denomination("tw", "25+25 ($)"), "25+25 $");
  assert.equal(normalize_denomination("cn", "20(C)"), "20(C)");
});

test("Taiwan orders early S/Y units before dollar values", () => {
  assert.deepEqual(
    order_denominations("tw", [
      "10($)",
      "2.00($)",
      "5S",
      "20(C)",
      "0.20($)",
      "3S",
      "1Y",
      "70(C)",
      "5Y",
      "1$",
      "5.00+1.00 $",
    ]),
    ["3S", "5S", "1Y", "5Y", "0.20$", "0.70$", "1$", "2$", "10$", "5+1 $"],
  );
});
