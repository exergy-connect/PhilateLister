/** Taiwan-specific denomination normalization and ordering. */
import { numericPrefix } from "./common.js";

/**
 * Canonical Taiwan denomination label:
 * - cents as dollars (`20(C)` → `0.20$`)
 * - drop trailing `.00` (`2.00($)` → `2($)`)
 * - treat `($)` as `$` (`1($)` → `1$`)
 */
export function normalizeDenomination(denomination) {
  let value = String(denomination ?? "").trim();
  if (!value) return value;

  const cents = value.match(/^(\d+(?:\.\d+)?)\(C\)$/i);
  if (cents) {
    value = `${(Number(cents[1]) / 100).toFixed(2)}$`;
  }

  return value
    .replace(/(\d+)\.00(?!\d)/g, "$1")
    .replace(/\(\$\)/g, "$");
}

/**
 * Sort key: early catalogue units (S, Y) before NT$ face values.
 * Surcharges / overprints sort after regulars by their numeric parts.
 */
export function denominationValue(denomination) {
  const value = normalizeDenomination(denomination);
  if (!value) return Number.POSITIVE_INFINITY;

  if (value.includes("/")) {
    const [neu, alt = ""] = value.split("/");
    return 1e9 + numericPrefix(neu) * 1e6 + Math.min(numericPrefix(alt), 999999);
  }

  const surcharge = value.match(/^([\d.]+)\s*\+\s*([\d.]+)/);
  if (surcharge) {
    return 1e8 + Number(surcharge[1]) * 1e3 + Math.min(Number(surcharge[2]), 999);
  }

  const number = numericPrefix(value);
  if (/^\d+(?:\.\d+)?S$/i.test(value)) return -300 + number;
  if (/^\d+(?:\.\d+)?Y$/i.test(value)) return -200 + number;
  if (/\$/.test(value)) return number;
  return Number.POSITIVE_INFINITY;
}
