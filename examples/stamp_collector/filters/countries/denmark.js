/** Denmark-specific denomination normalization and ordering. */
function numericPrefix(value) {
  const match = String(value ?? "").trim().match(/^([\d.½¼¾]+)/u);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1].replace("½", ".5").replace("¼", ".25").replace("¾", ".75"));
}

export function denmarkDenominationValue(denomination) {
  const value = String(denomination ?? "").trim();
  const number = numericPrefix(value);
  if (/R\.?\s*B\.?\s*S\.?$/i.test(value)) return -200 + number;
  if (/\d\s*(?:Sk\.?|S\.?)$/i.test(value)) return -100 + number;
  if (/øre|ore/i.test(value)) return number / 100;
  if (/kr\b|kron[ae]r?/i.test(value)) return number;
  return Number.POSITIVE_INFINITY;
}

export function orderDenmarkDenominations(denominations) {
  return [...denominations].sort(
    (a, b) => denmarkDenominationValue(a) - denmarkDenominationValue(b),
  );
}
