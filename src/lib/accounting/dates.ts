const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function hongKongToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function fiscalPeriodStart(todayIso: string, startMonth: number): string {
  const month = Math.min(12, Math.max(1, startMonth));
  const [yearText, monthText] = todayIso.split("-");
  const year = Number(yearText);
  const currentMonth = Number(monthText);
  const startYear = currentMonth >= month ? year : year - 1;
  return `${startYear}-${String(month).padStart(2, "0")}-01`;
}

export function formatIsoDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [, month, day] = iso.split("-").map(Number);
  const year = iso.slice(0, 4);
  return `${day} ${months[month - 1]} ${year}`;
}

export function monthStart(todayIso: string): string {
  return `${todayIso.slice(0, 7)}-01`;
}
