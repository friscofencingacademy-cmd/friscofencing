/**
 * "$292.50" — the one dollar formatter. Formatting only: every amount it is
 * given must already be a backend value (a price, a quote line, a ledger
 * amount). Never pass it the result of client-side arithmetic on money
 * (docs/design-system.md anti-pattern 10; CLAUDE.md Hard Rule 7).
 */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
