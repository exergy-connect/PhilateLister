import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { to_finder_sets } from '../filters/finder_catalog.js';

test('thematic export preserves country identity, sheet numbers and image origins', () => {
  const sets = to_finder_sets({ periods: { p: { sets: ['gambia', 'grenada'].map(country => ({
    id: `${country}-1`, ref: 'g0001', country, country_name: country,
    base: `https://${country}.example`, category: 'Postage stamps', year: 2001,
    catalogs: { scott: ['123'] }, stamps: [{ no: '0001', image: '/stamp.jpg' }],
  })) } } });
  assert.notEqual(sets[0].id, sets[1].id);
  assert.equal(sets[0].country, 'gambia');
  assert.equal(sets[0].stamps[0].image, 'https://gambia.example/stamp.jpg');
  assert.deepEqual(sets[0].catalogs.scott, ['123']);
  assert.match(sets[0].note, /gambia/);
});

test('viewer index exposes the new countries and a complete Pokemon collection', () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../catalogs/${name}.json`, import.meta.url)));
  const index = read('countries');
  for (const id of ['gm', 'gd', 'thematic-pokemon', 'thematic-ships']) {
    assert.ok(index.countries.some(c => c.id === id), id);
  }
  const pokemon = read('thematic-pokemon');
  assert.equal(pokemon.kind, 'thematic');
  assert.equal(pokemon.sets.reduce((n, s) => n + s.stamps.length, 0), 143);
  assert.equal(new Set(pokemon.sets.map(s => s.id)).size, pokemon.sets.length);
});
