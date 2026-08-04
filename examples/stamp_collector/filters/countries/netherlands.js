/** Netherlands-specific denomination normalization and ordering. */
import { numericPrefix } from "./common.js";

/**
 * Canonical Netherlands denomination label:
 * - `(C)` → `C` (`5(C)` → `5C`)
 * - `Gld` → `G` (`1Gld` → `1G`)
 * - decimal commas → dots (`1+€0,25` → `1+€0.25`)
 * - drop redundant surcharge parentheses (`1+(1) C` → `1+1 C`)
 * - unify euro surcharge order (`1+0.48 €` / `+€0.54 1` → `1+€0.48` / `1+€0.54`)
 */
export function normalizeDenomination(denomination) {
  let value = String(denomination ?? "").trim();
  if (!value) return value;

  value = value
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\(C\)/gi, "C")
    .replace(/Gld/gi, "G")
    .replace(/\+\(([\d.½¼¾]+)\)/gu, "+$1");

  value = value.replace(
    /^([\d.½¼¾]+)\+(\d+(?:\.\d+)?)\s*€$/u,
    "$1+€$2",
  );
  value = value.replace(/^\+€(\d+(?:\.\d+)?)\s+(\d+)$/u, "$2+€$1");
  value = value.replace(/^\+(\d+(?:\.\d+)?)\s+(\d+)$/u, "$2+$1");

  return value;
}

/** Face value on a guilder scale (cents ÷ 100); euros sit above guilders. */
function faceGuilders(token) {
  const value = String(token ?? "").trim();
  if (!value) return Number.POSITIVE_INFINITY;
  const number = numericPrefix(value);
  if (!Number.isFinite(number)) return Number.POSITIVE_INFINITY;
  if (/€/.test(value)) return 1000 + number;
  if (/G(?:\/|$)/i.test(value) || /G$/i.test(value)) return number;
  if (/C(?:\/|$)/i.test(value) || /C$/i.test(value)) return number / 100;
  return number;
}

/**
 * Sort key: cents (as guilder fractions), then guilders, then euros / rate labels.
 * Surcharges and overprints follow regulars by their numeric parts.
 */
export function denominationValue(denomination) {
  const value = normalizeDenomination(denomination);
  if (!value) return Number.POSITIVE_INFINITY;

  if (value.includes("/")) {
    const [neu, alt = ""] = value.split("/");
    return (
      1e9 + faceGuilders(neu) * 1e6 + Math.min(faceGuilders(alt), 999999)
    );
  }

  const euroSurcharge = value.match(
    /^([\d.½¼¾]+)\s*\+\s*€\s*([\d.]+)$/u,
  );
  if (euroSurcharge) {
    return (
      1e8 +
      faceGuilders(`${euroSurcharge[1]}€`) * 1e3 +
      Math.min(Number(euroSurcharge[2]), 999)
    );
  }

  const unitSurcharge = value.match(
    /^([\d.½¼¾]+)\s*\+\s*([\d.½¼¾]+)\s*(.*)$/u,
  );
  if (unitSurcharge) {
    const unit = String(unitSurcharge[3] ?? "").trim();
    const base = unit ? `${unitSurcharge[1]}${unit}` : unitSurcharge[1];
    const extra = unit ? `${unitSurcharge[2]}${unit}` : unitSurcharge[2];
    return 1e8 + faceGuilders(base) * 1e3 + Math.min(faceGuilders(extra), 999);
  }

  if (
    /Europa|Wereld|Internationaal|DECEMBER|Nederland|Gram|^R$|XL/i.test(value)
  ) {
    return 1e7 + faceGuilders(value);
  }

  if (/^\d+$/.test(value)) return 2000 + Number(value);

  if (/€/.test(value)) return 1000 + numericPrefix(value.replace(/^\(+/, ""));
  if (/G$/i.test(value)) return numericPrefix(value);
  if (/C$/i.test(value)) return numericPrefix(value) / 100;

  return Number.POSITIVE_INFINITY;
}
