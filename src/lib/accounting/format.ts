import { centsToDecimal, toCents } from "./money";

export function formatCents(cents: number, symbol = "HK$"): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-HK");
  const body = `${symbol}${whole}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `(${body})` : body;
}

export function formatDecimal(value: string | number | null | undefined, symbol = "HK$"): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatCents(toCents(value), symbol);
}

export function formatPlainDecimal(cents: number): string {
  return centsToDecimal(cents);
}
