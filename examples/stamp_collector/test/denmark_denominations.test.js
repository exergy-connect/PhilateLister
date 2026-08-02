import assert from "node:assert/strict";
import test from "node:test";
import { order_denominations } from "../filters/denominations.js";

test("Denmark orders skilling before normalized øre and kroner", () => {
  assert.deepEqual(
    order_denominations("dk", [
      "2Kr", "50Øre", "4S.", "4R.B.S.", "1Kr", "2Sk.", "2R.B.S.", "JUL",
    ]),
    ["2R.B.S.", "4R.B.S.", "2Sk.", "4S.", "50Øre", "1Kr", "2Kr", "JUL"],
  );
});
