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

test("China orders overprints by new face then old face", () => {
  assert.deepEqual(
    order_denominations("cn", [
      "50/20$/C",
      "100/5.00$",
      "50/2$",
      "50/10$",
      "400/5.00$",
      "50/10$/C",
      "100/2.50$",
      "20000/10000$",
    ]),
    [
      "50/2$",
      "50/10$",
      "50/10$/C",
      "50/20$/C",
      "100/2.50$",
      "100/5.00$",
      "400/5.00$",
      "20000/10000$",
    ],
  );
});

test("China orders surcharges by base then added value", () => {
  assert.deepEqual(
    order_denominations("cn", ["8+4 分", "8+2 分", "10+2分"]),
    ["8+2 分", "8+4 分", "10+2分"],
  );
});
