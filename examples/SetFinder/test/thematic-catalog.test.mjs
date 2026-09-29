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
  for (const id of ['gm', 'gd', 'thematic-pokemon', 'thematic-ships', 'thematic-cats', 'thematic-space']) {
    assert.ok(index.countries.some(c => c.id === id), id);
  }
  const pokemon = read('thematic-pokemon');
  assert.equal(pokemon.kind, 'thematic');
  assert.equal(pokemon.sets.reduce((n, s) => n + s.stamps.length, 0), 139);
  assert.equal(new Set(pokemon.sets.map(s => s.id)).size, pokemon.sets.length);
  const cats = read('thematic-cats');
  assert.equal(cats.kind, 'thematic');
  assert.equal(cats.sets.reduce((n, s) => n + s.stamps.length, 0), 49);
  assert.equal(new Set(cats.sets.map(s => s.id)).size, cats.sets.length);
  const space = read('thematic-space');
  assert.equal(space.kind, 'thematic');
  assert.equal(space.sets.reduce((n, s) => n + s.stamps.length, 0), 223);
  assert.equal(new Set(space.sets.map(s => s.id)).size, space.sets.length);
  const syzygy = space.sets.find((set) => set.catalog === '4398–4403');
  assert.equal(syzygy.sheet_image, 'https://www.stampworld.com/media/catalogue/Taiwan/Postage-stamps/4398-b.jpg');
  assert.equal(syzygy.image, syzygy.sheet_image);
  assert.ok(syzygy.stamps.every((stamp) => !stamp.image));
});

test('Albumview renders a sheet once and keeps its component records', async () => {
  const vm = await import('node:vm');
  const source = fs.readFileSync(new URL('../../AlbumView/templates/application/album.xpt', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function stampsForSet('), source.indexOf('function packLeaves('));
  const stampsForSet = vm.runInNewContext(`(${fn.trim()})`);
  const sheet = { sheet_image: 'https://example.com/sheet.jpg', catalogs: { scott: ['3571'] }, stamps: Array.from({length: 6}, (_,i) => ({no: String(6639+i)})) };
  const mounts = stampsForSet(sheet);
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].image, sheet.sheet_image);
  assert.deepEqual(mounts[0].catalogs.scott, ['3571']);
  assert.equal(sheet.stamps.length, 6);
  assert.equal(stampsForSet({stamps: sheet.stamps}).length, 6);
  const exported = to_finder_sets([{...sheet, year:2000, ref:'g6639'}])[0];
  assert.equal(exported.sheet_image, sheet.sheet_image);
});
