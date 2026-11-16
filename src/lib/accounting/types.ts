export const txnTypes = ["expense", "purchase", "sales"] as const;
export type TxnType = (typeof txnTypes)[number];

export const docTypeCodes = ["EJ", "PJ", "SJ"] as const;
export type DocTypeCode = (typeof docTypeCodes)[number];

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalBalance = "debit" | "credit";
export type PlGroup = "revenue" | "cogs" | "expense";
export type AccountSubtype =
  | "bank"
  | "cash"
  | "card"
  | "employee_band"
  | "receivable"
  | "payable"
  | "general";

export type ExtractionSource = "xai" | "stub" | "manual";

export type ExtractResult = {
  source: "xai" | "stub";
  txnDate: string;
  merchant: string;
  description: string;
  amount: string | null;
  currency: string;
  suggestedCategory: string | null;
  confidence: number;
  warnings: string[];
  model?: string;
};

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  plGroup: PlGroup | null;
};

export type JournalLeg = {
  accountId: string;
  date: string;
  debitCents: number;
  creditCents: number;
};

export type OpeningInput = {
  accountId: string;
  asOf: string;
  debitBalanceCents: number;
};

export type TrialRow = {
  account: LedgerAccount;
  openingCents: number;
  openingDebitCents: number;
  openingCreditCents: number;
  periodDebitCents: number;
  periodCreditCents: number;
  closingCents: number;
  naturalClosingCents: number;
  periodNaturalCents: number;
};

export type Statements = {
  trialBalance: TrialRow[];
  profitAndLoss: {
    revenue: TrialRow[];
    cogs: TrialRow[];
    expenses: TrialRow[];
    totalRevenueCents: number;
    totalCogsCents: number;
    grossProfitCents: number;
    totalExpenseCents: number;
    netIncomeCents: number;
  };
  balanceSheet: {
    assets: TrialRow[];
    liabilities: TrialRow[];
    equity: TrialRow[];
    totalAssetsCents: number;
    totalLiabilitiesCents: number;
    totalEquityCents: number;
    priorUnclosedCents: number;
    currentEarningsCents: number;
    totalLiabilitiesAndEquityCents: number;
    balanceCheckCents: number;
  };
  totals: {
    periodDebitCents: number;
    periodCreditCents: number;
    balanced: boolean;
    openingDebitBalanceCents: number;
  };
};

export function docTypeFor(type: TxnType): DocTypeCode {
  if (type === "sales") return "SJ";
  if (type === "purchase") return "PJ";
  return "EJ";
}

export function normalBalanceFor(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}
