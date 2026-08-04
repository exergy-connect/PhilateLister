/**
 * AlbumView filter helpers — light companion to SetFinder catalogs.
 * The browser loads shared public/catalogs JSON at runtime; these filters
 * document controls and support xform discovery.
 */
export function from_json(value) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") {
    throw new Error("from_json expects a JSON string or object");
  }
  return JSON.parse(value);
}

/** Default chrome options baked into the composed document. */
export function album_controls(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  return {
    default_country: String(src.default_country || "nl"),
    default_category: String(src.default_category || "Postage stamps"),
    show_catalog_value: Boolean(src.show_catalog_value),
  };
}

export default {
  from_json,
  album_controls,
};
