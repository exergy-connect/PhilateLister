/** China-specific denomination normalization and ordering. */
import { numericPrefix } from "./common.js";

/**
 * Numeric amount for one face-value token (yuan scale when unit is fen/yuan).
 * Bare numbers and `$` amounts keep their catalogue number.
 */
function faceAmount(token) {
  const value = String(token ?? "").trim();
  if (!value) return Number.POSITIVE_INFINITY;
  const number = numericPrefix(value);
  if (!Number.isFinite(number)) return Number.POSITIVE_INFINITY;
  if (/分/.test(value)) return number / 100;
  if (/元/.test(value)) return number;
  return number;
}

/**
 * Sort key for a China denomination label.
 * Regular: early catalogue `$` before fen/yuan (fen normalized to yuan).
 * Overprints `NEW/OLD…`: new face, then old face.
 * Surcharges `A+B 分`: base, then added value.
 */
export function denominationValue(denomination) {
  const value = String(denomination ?? "").trim();
  if (!value) return Number.POSITIVE_INFINITY;

  if (value.includes("/")) {
    const parts = value.split("/");
    const neu = parts[0] ?? "";
    const alt = parts[1] ?? "";
    return faceAmount(neu) * 1e6 + Math.min(faceAmount(alt), 999999);
  }

  const surcharge = value.match(
    /^([\d.½¼¾]+)\s*\+\s*([\d.½¼¾]+)\s*(.*)$/u,
  );
  if (surcharge) {
    const unit = String(surcharge[3] ?? "").trim();
    const base = unit ? `${surcharge[1]}${unit}` : surcharge[1];
    const extra = unit ? `${surcharge[2]}${unit}` : surcharge[2];
    return faceAmount(base) * 1e3 + Math.min(faceAmount(extra), 999);
  }

  // Early PRC dollar/$ catalogue values (often large); keep them before fen/yuan.
  if (/\$/.test(value)) return -1e12 + faceAmount(value);
  if (/分/.test(value)) return faceAmount(value);
  if (/元/.test(value)) return faceAmount(value);
  return Number.POSITIVE_INFINITY;
}
