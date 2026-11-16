import { splitDebitCredit } from "./money";
import type { JournalLeg, LedgerAccount, OpeningInput, Statements, TrialRow } from "./types";

function plBucket(account: LedgerAccount): "revenue" | "cogs" | "expense" | null {
  if (account.type === "revenue") return "revenue";
  if (account.type === "expense") return account.plGroup === "cogs" ? "cogs" : "expense";
  return null;
}

function latestOpening(openings: OpeningInput[], accountId: string, periodFrom: string): OpeningInput | undefined {
  let best: OpeningInput | undefined;
  for (const opening of openings) {
    if (opening.accountId !== accountId || opening.asOf > periodFrom) continue;
    if (!best || opening.asOf >= best.asOf) best = opening;
  }
  return best;
}

export function buildStatements(input: {
  accounts: LedgerAccount[];
  openings: OpeningInput[];
  lines: JournalLeg[];
  periodFrom: string;
  periodTo: string;
}): Statements {
  const linesByAccount = new Map<string, JournalLeg[]>();
  for (const line of input.lines) {
    const bucket = linesByAccount.get(line.accountId) ?? [];
    bucket.push(line);
    linesByAccount.set(line.accountId, bucket);
  }

  const trialBalance: TrialRow[] = input.accounts.map((account) => {
    const opening = latestOpening(input.openings, account.id, input.periodFrom);
    const floor = opening?.asOf ?? "0000-01-01";
    let priorDebit = 0;
    let priorCredit = 0;
    let periodDebit = 0;
    let periodCredit = 0;
    for (const line of linesByAccount.get(account.id) ?? []) {
      if (line.date > input.periodTo) continue;
      if (line.date >= input.periodFrom) {
        periodDebit += line.debitCents;
        periodCredit += line.creditCents;
      } else if (line.date >= floor) {
        priorDebit += line.debitCents;
        priorCredit += line.creditCents;
      }
    }
    const openingCents = (opening?.debitBalanceCents ?? 0) + priorDebit - priorCredit;
    const sides = splitDebitCredit(openingCents);
    const closingCents = openingCents + periodDebit - periodCredit;
    const naturalClosingCents = account.normalBalance === "debit" ? closingCents : -closingCents;
    const periodNaturalCents = account.normalBalance === "debit" ? periodDebit - periodCredit : periodCredit - periodDebit;
    return {
      account,
      openingCents,
      openingDebitCents: sides.debit,
      openingCreditCents: sides.credit,
      periodDebitCents: periodDebit,
      periodCreditCents: periodCredit,
      closingCents,
      naturalClosingCents,
      periodNaturalCents
    };
  });

  const revenue = trialBalance.filter((row) => plBucket(row.account) === "revenue");
  const cogs = trialBalance.filter((row) => plBucket(row.account) === "cogs");
  const expenses = trialBalance.filter((row) => plBucket(row.account) === "expense");
  const totalRevenueCents = revenue.reduce((sum, row) => sum + row.periodNaturalCents, 0);
  const totalCogsCents = cogs.reduce((sum, row) => sum + row.periodNaturalCents, 0);
  const totalExpenseCents = expenses.reduce((sum, row) => sum + row.periodNaturalCents, 0);
  const grossProfitCents = totalRevenueCents - totalCogsCents;
  const netIncomeCents = grossProfitCents - totalExpenseCents;

  const assets = trialBalance.filter((row) => row.account.type === "asset");
  const liabilities = trialBalance.filter((row) => row.account.type === "liability");
  const equity = trialBalance.filter((row) => row.account.type === "equity");
  const totalAssetsCents = assets.reduce((sum, row) => sum + row.naturalClosingCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((sum, row) => sum + row.naturalClosingCents, 0);
  const totalEquityCents = equity.reduce((sum, row) => sum + row.naturalClosingCents, 0);
  const plClosing = trialBalance
    .filter((row) => row.account.type === "revenue" || row.account.type === "expense")
    .reduce((sum, row) => sum + row.closingCents, 0);
  const priorUnclosedCents = -plClosing - netIncomeCents;
  const totalLiabilitiesAndEquityCents =
    totalLiabilitiesCents + totalEquityCents + priorUnclosedCents + netIncomeCents;

  const periodDebitCents = trialBalance.reduce((sum, row) => sum + row.periodDebitCents, 0);
  const periodCreditCents = trialBalance.reduce((sum, row) => sum + row.periodCreditCents, 0);
  const openingDebitBalanceCents = input.accounts.reduce((sum, account) => {
    const opening = latestOpening(input.openings, account.id, input.periodFrom);
    return sum + (opening?.debitBalanceCents ?? 0);
  }, 0);

  return {
    trialBalance,
    profitAndLoss: {
      revenue,
      cogs,
      expenses,
      totalRevenueCents,
      totalCogsCents,
      grossProfitCents,
      totalExpenseCents,
      netIncomeCents
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      totalAssetsCents,
      totalLiabilitiesCents,
      totalEquityCents,
      priorUnclosedCents,
      currentEarningsCents: netIncomeCents,
      totalLiabilitiesAndEquityCents,
      balanceCheckCents: totalAssetsCents - totalLiabilitiesAndEquityCents
    },
    totals: {
      periodDebitCents,
      periodCreditCents,
      balanced: periodDebitCents === periodCreditCents,
      openingDebitBalanceCents
    }
  };
}
