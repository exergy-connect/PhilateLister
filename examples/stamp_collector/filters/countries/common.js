/** Shared helpers for country denomination ordering. */

/** Parse a leading numeric amount, including vulgar fractions ½ ¼ ¾. */
export function numericPrefix(value) {
  const match = String(value ?? "").trim().match(/^([\d.½¼¾]+)/u);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1].replace("½", ".5").replace("¼", ".25").replace("¾", ".75"));
}
