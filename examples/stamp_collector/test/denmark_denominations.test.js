import assert from "node:assert/strict";
import test from "node:test";
import { orderDenmarkDenominations } from "../filters/countries/denmark.js";

test("Denmark orders skilling before normalized øre and kroner", () => {
  assert.deepEqual(
    orderDenmarkDenominations([
      "2Kr", "50Øre", "4S.", "4R.B.S.", "1Kr", "2Sk.", "2R.B.S.", "JUL",
    ]),
    ["2R.B.S.", "4R.B.S.", "2Sk.", "4S.", "50Øre", "1Kr", "2Kr", "JUL"],
  );
});
