const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}

/** "$40.25" for positives, "-$40.25" for negatives, sign kept out of the symbol. */
export function formatSigned(cents: number): string {
  return cents < 0 ? `-${usd.format(Math.abs(cents) / 100)}` : usd.format(cents / 100);
}

export const MAX_AMOUNT_CENTS = 100_000_000;

/**
 * Parse a user-typed dollar amount into integer cents.
 * Accepts "12", "12.5", "12.50", "$1,200.00". Returns null on anything else,
 * including amounts over MAX_AMOUNT_CENTS (which the server rejects too), so
 * the client catches them inline instead of on a failed round-trip.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0") || "0", 10);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}
