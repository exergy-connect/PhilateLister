import assert from "node:assert/strict";
import test from "node:test";
import { normalize_perforation } from "../filters/perforations.js";

test("normalizes perforation prefixes, spacing, separators, and common labels", () => {
  assert.equal(normalize_perforation(" Perf: 12½x12 "), "12½ x 12");
  assert.equal(normalize_perforation("Perforation: 14 × 13½"), "14 x 13½");
  assert.equal(normalize_perforation("11½ – 14"), "11½-14");
  assert.equal(normalize_perforation("imperf"), "Imperforated");
  assert.equal(normalize_perforation("die-cut"), "Die Cut");
  assert.equal(normalize_perforation("rouletted 11"), "Rouletted 11");
  assert.equal(normalize_perforation(null), "");
});
