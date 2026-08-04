/**
 * Country packs live at countries/<id>.xpt as flat instance attributes, e.g.:
 *
 *   stampworld: China,-Peoples-Rep.
 *   categories: ["Postage stamps"]
 *   periods: ["1990-1999", ...]
 *
 * xForm resolves these through `country._templates` (`country[<id>]`) and
 * derives the instance id as `_id` / `name`. Select with:
 *   --with target_country=china
 */
import { consolidate_periods } from "./consolidate.js";
import { country_output_dir } from "./scrape.js";

/** xForm instance id: `_id` when bound, else template `name` from country[<id>]. */
function instance_id(country) {
  return String(country?._id ?? country?.name ?? "").trim();
}

/**
 * Map a country concept → catalogue scrape query.
 * `country` is the StampWorld slug (URL); the instance id is the output/ folder.
 */
export function as_catalog_query(country) {
  if (!country || typeof country !== "object" || Array.isArray(country)) {
    throw new Error(
      `as_catalog_query expects a country concept object; received: ${JSON.stringify(country)}`,
    );
  }
  const stampworld = String(country.stampworld ?? "").trim();
  if (!stampworld) {
    throw new Error("as_catalog_query: country.stampworld is required");
  }
  const id = instance_id(country);
  if (!id) {
    throw new Error("as_catalog_query: country._id (or name) is required");
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error(`as_catalog_query: invalid country id: ${id}`);
  }
  const categories = country.categories;
  const periods = country.periods;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("as_catalog_query: country.categories is required");
  }
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new Error("as_catalog_query: country.periods is required");
  }
  const code = String(country.code ?? id).trim();
  if (!code) {
    throw new Error("as_catalog_query: country.code (or id) is required");
  }
  if (code.includes("..") || code.includes("/") || code.includes("\\")) {
    throw new Error(`as_catalog_query: invalid country.code: ${code}`);
  }
  return {
    id,
    code,
    country: stampworld,
    categories,
    periods,
  };
}

/** Output directory key for a country concept (xForm-derived instance id). */
export function country_id(country) {
  if (country && typeof country === "object") {
    const id = instance_id(country);
    if (id) return id;
  }
  throw new Error("country_id expects a country concept with ._id or .name");
}

/**
 * Attach country concept id/stampworld onto a consolidated collection
 * so writers land under output/<id>/.
 */
export function with_country_meta(collection, country) {
  const q = as_catalog_query(country);
  return {
    ...collection,
    id: q.id,
    country: q.country,
  };
}

/**
 * Merge period JSON under output/<id>/ for a loaded country concept.
 * `output_dir` is the root (default `output`).
 */
export function consolidate_country(country, output_dir = "output") {
  const id = country_id(country);
  const dir = country_output_dir(id, output_dir);
  return with_country_meta(
    consolidate_periods(dir, country.denominations ?? {}),
    country,
  );
}

export default {
  as_catalog_query,
  country_id,
  with_country_meta,
  consolidate_country,
};
