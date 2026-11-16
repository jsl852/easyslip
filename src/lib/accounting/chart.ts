import { normalBalanceFor, type AccountSubtype, type AccountType, type PlGroup } from "./types";

export type ChartAccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  isSettlement: boolean;
  plGroup: PlGroup | null;
  sortOrder: number;
};

export type CategorySeed = {
  name: string;
  kind: "revenue" | "cogs" | "expense";
  accountCode: string;
};

export type RuleSeed = {
  pattern: string;
  categoryName: string;
  priority: number;
};

export const starterAccounts: ChartAccountSeed[] = [
  { code: "1000", name: "Cash on hand", type: "asset", subtype: "cash", isSettlement: true, plGroup: null, sortOrder: 10 },
  { code: "1100", name: "Current account", type: "asset", subtype: "bank", isSettlement: true, plGroup: null, sortOrder: 20 },
  { code: "1200", name: "Savings account", type: "asset", subtype: "bank", isSettlement: true, plGroup: null, sortOrder: 30 },
  { code: "1300", name: "Accounts receivable", type: "asset", subtype: "receivable", isSettlement: false, plGroup: null, sortOrder: 40 },
  { code: "2100", name: "Accounts payable", type: "liability", subtype: "payable", isSettlement: false, plGroup: null, sortOrder: 50 },
  { code: "2200", name: "Company credit card", type: "liability", subtype: "card", isSettlement: true, plGroup: null, sortOrder: 60 },
  { code: "3000", name: "Owner's capital", type: "equity", subtype: "general", isSettlement: false, plGroup: null, sortOrder: 70 },
  { code: "3100", name: "Retained earnings", type: "equity", subtype: "general", isSettlement: false, plGroup: null, sortOrder: 80 },
  { code: "4000", name: "Sales", type: "revenue", subtype: "general", isSettlement: false, plGroup: "revenue", sortOrder: 90 },
  { code: "4900", name: "Other income", type: "revenue", subtype: "general", isSettlement: false, plGroup: "revenue", sortOrder: 100 },
  { code: "5000", name: "Purchases", type: "expense", subtype: "general", isSettlement: false, plGroup: "cogs", sortOrder: 110 },
  { code: "6000", name: "Meals and entertainment", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 120 },
  { code: "6100", name: "Travel and transport", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 130 },
  { code: "6200", name: "Office supplies", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 140 },
  { code: "6300", name: "Software and subscriptions", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 150 },
  { code: "6400", name: "Utilities", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 160 },
  { code: "6500", name: "Rent", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 170 },
  { code: "6600", name: "Professional fees", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 180 },
  { code: "6700", name: "Bank charges", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 190 },
  { code: "6800", name: "Telephone and internet", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 200 },
  { code: "6900", name: "General expenses", type: "expense", subtype: "general", isSettlement: false, plGroup: "expense", sortOrder: 210 }
];

export const starterCategories: CategorySeed[] = [
  { name: "Sales", kind: "revenue", accountCode: "4000" },
  { name: "Other income", kind: "revenue", accountCode: "4900" },
  { name: "Purchases", kind: "cogs", accountCode: "5000" },
  { name: "Meals and entertainment", kind: "expense", accountCode: "6000" },
  { name: "Travel and transport", kind: "expense", accountCode: "6100" },
  { name: "Office supplies", kind: "expense", accountCode: "6200" },
  { name: "Software and subscriptions", kind: "expense", accountCode: "6300" },
  { name: "Utilities", kind: "expense", accountCode: "6400" },
  { name: "Rent", kind: "expense", accountCode: "6500" },
  { name: "Professional fees", kind: "expense", accountCode: "6600" },
  { name: "Bank charges", kind: "expense", accountCode: "6700" },
  { name: "Telephone and internet", kind: "expense", accountCode: "6800" },
  { name: "General expenses", kind: "expense", accountCode: "6900" }
];

export const starterRules: RuleSeed[] = [
  { pattern: "microsoft", categoryName: "Software and subscriptions", priority: 20 },
  { pattern: "adobe", categoryName: "Software and subscriptions", priority: 20 },
  { pattern: "starbucks", categoryName: "Meals and entertainment", priority: 10 },
  { pattern: "mtr", categoryName: "Travel and transport", priority: 10 },
  { pattern: "uber", categoryName: "Travel and transport", priority: 10 }
];

export function normalOfSeed(account: ChartAccountSeed) {
  return normalBalanceFor(account.type);
}
