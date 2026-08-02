/** China-specific denomination normalization and ordering. */
import { numericPrefix } from "./common.js";

export function denominationValue(denomination) {
  const value = String(denomination ?? "").trim();
  const number = numericPrefix(value);
  // Early PRC dollar/$ catalogue values (often large); keep them before fen/yuan.
  if (/\$/.test(value)) return -1e12 + number;
  if (/分/.test(value)) return number / 100;
  if (/元/.test(value)) return number;
  return Number.POSITIVE_INFINITY;
}
