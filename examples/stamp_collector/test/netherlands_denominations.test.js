import assert from "node:assert/strict";
import test from "node:test";
import {
  normalize_denomination,
  order_denominations,
} from "../filters/denominations.js";

test("Netherlands collapses (C)/Gld and euro surcharge spellings", () => {
  assert.equal(normalize_denomination("nl", "5(C)"), "5C");
  assert.equal(normalize_denomination("nl", "5C"), "5C");
  assert.equal(normalize_denomination("nl", "1Gld"), "1G");
  assert.equal(normalize_denomination("nl", "2½Gld"), "2½G");
  assert.equal(normalize_denomination("nl", "2.50Gld"), "2.50G");
  assert.equal(normalize_denomination("nl", "1+(1) C"), "1+1 C");
  assert.equal(normalize_denomination("nl", "1+€0,25"), "1+€0.25");
  assert.equal(normalize_denomination("nl", "1+0.48 €"), "1+€0.48");
  assert.equal(normalize_denomination("nl", "+€0.54 1"), "1+€0.54");
  assert.equal(normalize_denomination("nl", "2.50/10Gld"), "2.50/10G");
  assert.equal(normalize_denomination("cn", "5(C)"), "5(C)");
});

test("Netherlands orders cents before guilders before euros", () => {
  assert.deepEqual(
    order_denominations("nl", [
      "1€",
      "1Gld",
      "50C",
      "5(C)",
      "½C",
      "2.50G",
      "10C",
      "1 Europa",
      "1+€0,25",
      "10+5 C",
    ]),
    ["½C", "5C", "10C", "50C", "1G", "2.50G", "1€", "1 Europa", "10+5 C", "1+€0.25"],
  );
});
