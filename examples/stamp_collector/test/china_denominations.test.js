import assert from "node:assert/strict";
import test from "node:test";
import { order_denominations } from "../filters/denominations.js";

test("China orders early $ before normalized fen and yuan", () => {
  assert.deepEqual(
    order_denominations("cn", [
      "2元", "50分", "100$", "1元", "½分", "30.00$", "80分", "元",
      "3000$", "200.00$", "200$", "5分", "1分", "1.20元",
    ]),
    [
      "30.00$", "100$", "200.00$", "200$", "3000$",
      "½分", "1分", "5分", "50分", "80分",
      "1元", "1.20元", "2元", "元",
    ],
  );
});
