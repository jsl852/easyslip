export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const raw = typeof value === "number" ? value.toFixed(6) : String(value).trim().replace(/,/g, "");
  if (!raw || raw === "-" || raw === "." || raw === "-.") return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  if (!/^\d*(\.\d*)?$/.test(unsigned)) {
    throw new Error(`Not a money amount: ${value}`);
  }
  const [wholePart, fracPart = ""] = unsigned.split(".");
  const whole = wholePart ? Number(wholePart) : 0;
  const digits = (fracPart + "000").slice(0, 3);
  const cents = whole * 100 + Number(digits.slice(0, 2));
  const rounded = Number(digits[2]) >= 5 ? cents + 1 : cents;
  return negative ? -rounded : rounded;
}

export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

export function splitDebitCredit(debitBalanceCents: number): { debit: number; credit: number } {
  if (debitBalanceCents >= 0) return { debit: debitBalanceCents, credit: 0 };
  return { debit: 0, credit: -debitBalanceCents };
}
