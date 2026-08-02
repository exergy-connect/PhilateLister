import { orderDenmarkDenominations } from "./countries/denmark.js";

const COUNTRY_ORDER = {
  dk: orderDenmarkDenominations,
};

/** Apply country-owned denomination ordering; unknown countries retain source order. */
export function order_denominations(countryCode, denominations) {
  const values = [...denominations];
  const order = COUNTRY_ORDER[String(countryCode ?? "").toLowerCase()];
  return order ? order(values) : values;
}
