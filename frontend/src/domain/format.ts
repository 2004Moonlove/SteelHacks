const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Format canonical integer cents without losing precision in a dollar conversion. */
export function formatMoney(cents: number): string {
  const value = BigInt(cents);
  const amount = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}$${wholeNumber.format(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
}
