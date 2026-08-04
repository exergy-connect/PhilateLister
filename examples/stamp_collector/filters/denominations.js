import { denominationValue as chinaDenominationValue } from "./countries/china.js";
import { denominationValue as denmarkDenominationValue } from "./countries/denmark.js";
import {
  denominationValue as netherlandsDenominationValue,
  normalizeDenomination as netherlandsNormalizeDenomination,
} from "./countries/netherlands.js";
import {
  denominationValue as taiwanDenominationValue,
  normalizeDenomination as taiwanNormalizeDenomination,
} from "./countries/taiwan.js";

const COUNTRY_VALUE = {
  cn: chinaDenominationValue,
  dk: denmarkDenominationValue,
  nl: netherlandsDenominationValue,
  tw: taiwanDenominationValue,
};

const COUNTRY_NORMALIZE = {
  nl: netherlandsNormalizeDenomination,
  tw: taiwanNormalizeDenomination,
};

/** Country-owned canonical denomination label; unknown countries pass through. */
export function normalize_denomination(countryCode, denomination) {
  const value = String(denomination ?? "").trim();
  const normalize = COUNTRY_NORMALIZE[String(countryCode ?? "").toLowerCase()];
  return normalize ? normalize(value) : value;
}

/** Apply country-owned denomination ordering; unknown countries retain source order. */
export function order_denominations(countryCode, denominations) {
  const values = [
    ...new Set(
      [...denominations].map((d) => normalize_denomination(countryCode, d)),
    ),
  ].filter(Boolean);
  const valueOf = COUNTRY_VALUE[String(countryCode ?? "").toLowerCase()];
  if (!valueOf) return values;
  return values.sort(
    (a, b) => valueOf(a) - valueOf(b) || String(a).localeCompare(String(b), "en"),
  );
}
