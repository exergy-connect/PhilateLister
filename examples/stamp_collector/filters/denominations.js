import { denominationValue as chinaDenominationValue } from "./countries/china.js";
import { denominationValue as denmarkDenominationValue } from "./countries/denmark.js";

const COUNTRY_VALUE = {
  cn: chinaDenominationValue,
  dk: denmarkDenominationValue,
};

/** Apply country-owned denomination ordering; unknown countries retain source order. */
export function order_denominations(countryCode, denominations) {
  const values = [...denominations];
  const valueOf = COUNTRY_VALUE[String(countryCode ?? "").toLowerCase()];
  if (!valueOf) return values;
  return values.sort((a, b) => valueOf(a) - valueOf(b));
}
