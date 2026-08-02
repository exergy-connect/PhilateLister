/** Root filter module for CLI / lab UI discovery. */
export {
  from_json,
  to_pretty_json,
  add_thumbnails,
  denomValue,
  lowestDenomStamp,
} from "./filters/thumbnails.js";

export { scrape_catalogue } from "./filters/scrape.js";
export { consolidate_periods } from "./filters/consolidate.js";

import thumbnails from "./filters/thumbnails.js";
import { scrape_catalogue } from "./filters/scrape.js";
import { consolidate_periods } from "./filters/consolidate.js";

export default { ...thumbnails, scrape_catalogue, consolidate_periods };
