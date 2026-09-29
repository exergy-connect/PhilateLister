#!/usr/bin/env node
// Validate the US crosswalk against its dated StampWorld key inventory.
// --unmapped prints the exact keys still needing research, one per line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const doc = read("../catalogs/scott/united-states.json");
const inventory = read("../catalogs/scott/coverage/united-states.json");
const mappings = doc.mappings;
const setMappings = doc.set_mappings;
const keys = new Set();
const setKeys = new Set();
const missing = [];
let setOnly = 0;

assert.equal(doc.country, inventory.country);
assert.equal(doc.coverage.checked_at, inventory.checked_at);
for (const [category, sets] of Object.entries(inventory.categories)) {
  const counts = { source_stamps: 0, individual_mappings: 0, set_reference_only: 0, unmapped: 0 };
  for (const [ref, set] of Object.entries(sets)) {
    const setKey = `${category}::${ref}`;
    setKeys.add(setKey);
    assert.ok(Number.isInteger(set.year), setKey);
    for (const no of set.stamps) {
      const key = `${setKey}::${no}`;
      assert.ok(!keys.has(key), `Duplicate source key: ${key}`);
      keys.add(key);
      counts.source_stamps++;
      if (mappings[key]) counts.individual_mappings++;
      else if (setMappings[setKey]) counts.set_reference_only++;
      else {
        counts.unmapped++;
        missing.push(key);
      }
    }
  }
  for (const [field, count] of Object.entries(counts)) {
    assert.equal(doc.coverage.categories[category][field], count, `${category}: ${field}`);
  }
  setOnly += counts.set_reference_only;
}

for (const [key, entry] of Object.entries(mappings)) {
  assert.ok(keys.has(key), `Unknown stamp key: ${key}`);
  assert.match(entry.number, /^(?:[A-Z]+)?\d+[A-Za-z]*$/, key);
  assert.equal(entry.relation, "exact", key);
}
for (const [key, entry] of Object.entries(setMappings)) {
  assert.ok(setKeys.has(key), `Unknown issue key: ${key}`);
  assert.ok(["set", "sheet"].includes(entry.relation), key);
  assert.match(entry.number, /^(?:[A-Z]+)?\d+[A-Za-z]*(?:-(?:(?:[A-Z]+)?\d+)?[A-Za-z]*)?$/, key);
}
for (const [key, entry] of [...Object.entries(mappings), ...Object.entries(setMappings)]) {
  assert.ok(["inferred", "verified"].includes(entry.status), key);
  assert.ok(entry.sources?.length, `Missing provenance: ${key}`);
  for (const source of entry.sources) {
    assert.equal(new URL(source).protocol, "https:", key);
    assert.ok(doc.sources.includes(source), `Unregistered source: ${source}`);
  }
}
assert.equal(doc.coverage.source_stamps, keys.size);
assert.equal(doc.coverage.individual_mappings, Object.keys(mappings).length);
assert.equal(doc.coverage.set_mappings, Object.keys(setMappings).length);
// Even complete StampWorld coverage would not establish complete Scott coverage.
assert.equal(doc.coverage.complete, false);
if (process.argv.includes("--unmapped")) console.log(missing.join("\n"));
else console.log(`${keys.size} source stamps: ${Object.keys(mappings).length} individual mappings, ${setOnly} with issue references only, ${missing.length} unmapped. Coverage is partial.`);
