import { isIsoDate } from "./dates";

export type FilenameHint = {
  date: string | null;
  merchant: string | null;
  amount: string | null;
};

export function parseFilenameHint(fileName: string): FilenameHint {
  const base = fileName.replace(/\.[^.]+$/, "");
  const dateMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
  const amountMatch = base.match(/(?:^|[\s_-])(\d+\.\d{2})$/);
  let merchant: string | null = null;
  if (dateMatch && amountMatch && dateMatch.index !== undefined && amountMatch.index !== undefined) {
    const middle = base
      .slice(dateMatch.index + dateMatch[0].length, amountMatch.index)
      .replace(/^[\s_-]+|[\s_-]+$/g, "")
      .replace(/[_-]+/g, " ")
      .trim();
    merchant = middle || null;
  }
  const date = dateMatch && isIsoDate(dateMatch[1]) ? dateMatch[1] : null;
  return {
    date,
    merchant,
    amount: amountMatch ? amountMatch[1] : null
  };
}

export function journalDescription(merchant: string, description: string): string {
  const cleanMerchant = merchant.trim();
  const cleanDescription = description.trim();
  if (!cleanMerchant) return cleanDescription.slice(0, 500);
  if (!cleanDescription || cleanDescription.toLowerCase() === cleanMerchant.toLowerCase()) {
    return cleanMerchant.slice(0, 500);
  }
  return `${cleanMerchant} — ${cleanDescription}`.slice(0, 500);
}
