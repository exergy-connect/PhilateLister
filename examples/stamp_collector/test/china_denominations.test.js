import assert from "node:assert/strict";
import test from "node:test";
import { order_denominations } from "../filters/denominations.js";

test("China orders early $ before normalized fen and yuan", () => {
  assert.deepEqual(
    order_denominations("cn", [
      "2元", "50分", "100$", "1元", "½分", "30.00$", "80分", "元",
    ]),
    ["30.00$", "100$", "½分", "50分", "80分", "1元", "2元", "元"],
  );
});
