/** Denmark-specific denomination normalization and ordering. */
import { numericPrefix } from "./common.js";

export function denominationValue(denomination) {
  const value = String(denomination ?? "").trim();
  const number = numericPrefix(value);
  if (/R\.?\s*B\.?\s*S\.?$/i.test(value)) return -200 + number;
  if (/\d\s*(?:Sk\.?|S\.?)$/i.test(value)) return -100 + number;
  if (/øre|ore/i.test(value)) return number / 100;
  if (/kr\b|kron[ae]r?/i.test(value)) return number;
  return Number.POSITIVE_INFINITY;
}
