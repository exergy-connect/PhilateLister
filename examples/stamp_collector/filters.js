/** Root filter module for CLI / lab UI discovery. */
export {
  from_json,
  to_pretty_json,
  add_thumbnails,
  denomValue,
  lowestDenomStamp,
} from "./filters/thumbnails.js";

export {
  scrape_catalogue,
  country_dir,
  country_output_dir,
} from "./filters/scrape.js";
export { collect_catalogue } from "./filters/collect.js";
export {
  category_period_basename,
  category_period_path,
  parse_category_period_filename,
  country_code,
} from "./filters/paths.js";
export {
  as_catalog_query,
  country_id,
  with_country_meta,
  consolidate_country,
} from "./filters/country.js";
export { consolidate_periods } from "./filters/consolidate.js";
export { normalize_perforation } from "./filters/perforations.js";
export { write_period_json, write_collection_xp } from "./filters/write_output.js";

import thumbnails from "./filters/thumbnails.js";
import scrape from "./filters/scrape.js";
import collect from "./filters/collect.js";
import paths from "./filters/paths.js";
import country from "./filters/country.js";
import { consolidate_periods } from "./filters/consolidate.js";
import perforations from "./filters/perforations.js";
import writeOutput from "./filters/write_output.js";

export default {
  ...thumbnails,
  ...scrape,
  ...collect,
  ...paths,
  ...country,
  consolidate_periods,
  ...perforations,
  ...writeOutput,
};
