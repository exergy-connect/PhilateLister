# Stamp collector

Country packs in `countries/` drive `./collect.sh <country>` and
`./consolidate.sh <country>`. Scott crosswalks in `catalogs/scott/` enrich
country stamps during consolidation.

## United States Scott crosswalk

Use `./collect.sh united-states` and `./consolidate.sh united-states` for the
US country pack. It requests 1847–2026 postage and all 15 back-of-book categories
exposed by StampWorld. The pack uses country id `united-states` and code `us`.

[`catalogs/scott/united-states.json`](catalogs/scott/united-states.json) contains
1,489 individual mappings and 291 issue/sheet references, researched on
2026-09-29. **This is a partial crosswalk, not all Scott numbers to date.**
Its `coverage` object records the gaps and latest source set year per category
(some sets span multiple issue years).
For example, StampWorld's interior duck-stamp listings stop at 2016; requesting
2026 does not supply the missing later issues. Categories not offered by the
source, such as newspaper stamps, are not represented by fabricated source ids.

Mappings use `category::set_ref::stamp_number`, preserving leading zeros and
case-sensitive suffixes. Sources are recorded on every assertion. The assertions
are marked `inferred`: they compare published issue details from StampWorld,
Bardo Stamps, Stamp Smarter, and the other cited references, rather than a
complete Scott export. Where catalogue details conflict, an issue match is not
a guarantee of every specialized variety. Missing mappings stay unset.

`set_mappings` distinguish whole sheets (`relation: sheet`) from issue ranges
(`relation: set`, e.g. `6046-6049`). Both stay on the set. An issue range does
not assign its numbers to individual stamps; neither range order nor component
suffixes are inferred. Semipostals B1–B7 are in the source's `Postage stamps`
category. Back-of-book mappings include C, CE, E, F, FA, J, JQ, O, PN, Q, QE,
and RW prefixes.

The dated key inventory in
[`catalogs/scott/coverage/united-states.json`](catalogs/scott/coverage/united-states.json)
contains all 7,675 observed source records, including unmapped ones. Validate
coverage or print the exact keys requiring further research:

```sh
node scripts/check_scott_us.mjs
node scripts/check_scott_us.mjs --unmapped
```

Finishing the requested coverage requires additional verified Scott/StampWorld
correspondences and source records for missing Scott issues. A complete numeric
range cannot substitute for those correspondences.

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

`catalogs/thematic/pokemon.json` selects 139 records from 12 issuing territories.
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
| France | 2024 | Not asserted |

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
[Japan Post's issue announcement](https://www.post.japanpost.jp/kitte/collection/archive/2021/0707_01/0235.pdf).
Those local ids do not claim Scott or StampWorld identities.

Coverage is not exhaustive. The notes identify the Guyana date discrepancy,
unresolved Dominica overprint variants, and the forthcoming Taiwan issue
(scheduled for November 20, 2026, so excluded from issued stamps as of this research).

## Cats collection

Build the bundled collection offline:

```sh
node scripts/build_thematic_catalog.mjs cats
```

`catalogs/thematic/cats.json` selects 49 records from 6 issuing territories.
The result is `output/thematic/cats/collection.xp`.

| Country / territory | Included issues | Notes |
| --- | --- | --- |
| China | 1990 snow leopard | 2013 pedigree cats not in the collected pack |
| Iceland | 1982 Felis catus; 1990 and 2008 Christmas Cat; 1998 Yule Cat | Mixed domestic-animal and Christmas sets keep only the cat stamp |
| Taiwan | 2004 Hello Kitty; 2005–2006 Pets cat values; 2022 leopard cat | Dog values from Pets I–IV omitted |
| Gambia | 2000 Stamp Show, London — cats | Collected coverage is 2000–2002 only |
| Grenada | 2000 cats | Collected coverage is 2000–2002 only |
| Netherlands | 1998 Pets kittens (1675); 2024 Typically Dutch — Cats | 1676 is a dog and 1677 is a rabbit. The 2015 Top 40 stamp for the band The Cats is excluded |

Scott numbers are not asserted. Mixed sets include only stamps identified as cats
from StampWorld descriptions or the [Cat Stamps](https://www.catstamps.org/)
topical checklists. Chunghwa Post pages document Hello Kitty, the Pets series
and the leopard-cat issue.

## Space collection

Build the bundled collection offline:

```sh
node scripts/build_thematic_catalog.mjs space
```

`catalogs/thematic/space.json` selects 223 records from 8 issuing territories.
The result is `output/thematic/space/collection.xp`.

| Country / territory | Included issues | Notes |
| --- | --- | --- |
| Armenia | 2002 cosmic research; 2007 Year of the Moon; 2009 Europa astronomy; 2011 first manned flight | |
| China | 1958 Sputnik; 1959–1960 lunar rockets; 1962 astronomer Ku Shou-chin; 1982 UN outer space; 1986 space research and Halley’s comet; 2020 first satellite | Scientists set keeps only the astronomer |
| Gambia | 2000 Apollo–Soyuz; Expo 2000 space satellites | Collected coverage is 2000–2002 only |
| Grenada | 2000 Apollo–Soyuz; Expo 2000 spacecraft; seventeenth-century astronomy | Telescope, Saturn, Mars, and Jupiter’s moons only |
| Iceland | 1991 Europa space research; 2009 Europa astronomy | Geothermal “space heating” and Year of Planet Earth omitted |
| Netherlands | Satellite station, Moon landing, zodiac constellations, Europa astronomy, seen from space, journey to the Moon, space explorers | Zodiac set is included as constellations |
| Taiwan | Satellite stations, first man on the Moon, Schall von Bell, astronomy, syzygy paintings | Moon-shaped fans and Sun Moon Lake omitted |
| United States | Observatory, Goddard, Apollo, probes, shuttle, Hubble, planets, Webb telescope, and six Celebrate the Century stamps | Mixed century sheets keep only the space subjects |

Denmark and Sweden’s collected issues have no spaceflight or astronomy subjects.
Scott numbers are not asserted. Celebrate the Century picks follow the published
sheet order (Explorer I, the Moon landing, Star Trek, Pioneer 10, the Space Shuttle,
and John Glenn’s return). Star Trek is included; E.T. is not.
