# Stamp collector

Country packs in `countries/` drive `./collect.sh <country>` and
`./consolidate.sh <country>`. Scott crosswalks in `catalogs/scott/` enrich
country stamps during consolidation.

## Thematic catalogs

A thematic catalog selects stamps from multiple countries using the already
collected country JSON files. It requires no additional downloads. Definitions
live in `catalogs/thematic/<id>.json`; `ships.json` is a small working example.

```json
{
  "id": "ships",
  "kind": "thematic",
  "title": "Ships and boats",
  "entries": [
    { "country": "denmark", "category": "Christmas stamps", "set_ref": "g0019", "no": "0019" },
    { "country": "iceland", "category": "Postage stamps", "set_ref": "g0754", "no": "0754" }
  ]
}
```

`country` is the country pack/directory id. `category` is the exact StampWorld
category and `no` is a source record number **string**, preserving leading zeros.
Normally this is a StampWorld number; postal-authority supplements use explicit
local ids and mark their stamps with `numbering_system: local`.
Optional `set_ref` identifies an issue when a number occurs in multiple sets.
Missing, ambiguous or duplicate selections fail the build, so incomplete
catalogs are not silently published. Country data must have been collected first.

From this directory, run:

```sh
node scripts/build_thematic_catalog.mjs ships
# Optional alternative root containing collected country directories:
node scripts/build_thematic_catalog.mjs ships /path/to/output
```

The result is `output/thematic/ships/collection.xp`, using the existing XP
collection format with `periods` and `sets`. It includes `kind: thematic`, a
`countries` list and total counts. Sets and stamps retain country ids; sets also
carry the source country name, code and base URL. Set ids are qualified by
country/category/period, with the original id retained as `source_id`. Only
selected stamps appear; their images, catalog numbers and issue details are
preserved. There is no single collection-level country or currency summary.

Filters `load_thematic_catalog(id)` and
`consolidate_thematic_catalog(definition, output_dir)` are also exported through
`filters.js`. Use `write_collection_xp(result, output_dir + '/thematic')` to
write the resulting collection separately from country catalogs.

Run tests with `node --test test/*.test.js`.

## Pokémon collection

Build the bundled collection offline:

```sh
node scripts/build_thematic_catalog.mjs pokemon
```

`catalogs/thematic/pokemon.json` selects 143 records from 12 issuing territories.
The result is `output/thematic/pokemon/collection.xp`.

| Country / territory | Included issues | Scott sheet / souvenir-sheet references |
| --- | --- | --- |
| Gambia | 2001 | 2393–2394 |
| Grenada | 2001, 2002 | 3088–3089, 3269–3270 |
| Grenada Grenadines | 2001 | 2284–2285 |
| Antigua and Barbuda | 2001, 2002 | 2425–2426, 2586–2587 |
| Guyana | 2000/2001 (source date conflict) | 3571–3572 |
| Dominica | 2001 | 2266–2267 |
| Liberia | 2001 | Not asserted |
| St. Vincent and the Grenadines | 2001 | 2890–2891 |
| Micronesia | 2001 | 414–415 |
| Sierra Leone | 2002 | 2557–2558 |
| Japan | 2005; 2021 greetings and Stamp Box | Not asserted |
| France | 2024 Pikachu, booklet, four-stamp collector | Not asserted |

Country packs and Scott crosswalks are included for Gambia and Grenada.
Their bundled country data covers **Postage stamps, 2000–2002** (1,456 and
1,138 stamp records respectively), with consolidated `collection.xp` files.
The country packs allow collecting other periods with the existing `collect.sh`.
The other countries contain Pokémon extracts only, not complete country catalogs.
Files named `Thematic extracts.*.json` keep these partial extracts separate from
normal collector caches. `Official supplements.*.json` hold manually curated
postal-authority records; refreshing StampWorld data does not overwrite them.

Scott `set_mappings` keys use `<category>::<set_ref>`. Sheet references appear
in `set.catalogs.scott`, with relation and evidence in `set.catalog_details.scott`.
Individual stamp crosswalks remain in `mappings`; unverified component suffixes
are never inferred from sheet order. One-stamp souvenir sheets have both set
and stamp references. Counts describe selected stamp records, not whole sheets.

Every selected set includes a `source_url`. Catalog-level `sources` and `notes`
are retained in the generated collection. The Japan 2021 supplement follows
[Japan Post's issue announcement](https://www.post.japanpost.jp/kitte/collection/archive/2021/0707_01/0235.pdf);
France's supplementary collector follows
[La Poste's announcement](https://www.lecarredencre.fr/timbre/pokemon/).
These local ids do not claim Scott or StampWorld identities.

Coverage is not exhaustive. The notes identify the Guyana date discrepancy,
unresolved Dominica overprint variants, and the forthcoming Taiwan issue
(scheduled for November 20, 2026, so excluded from issued stamps as of this research).
