import { docTypeFor, type DocTypeCode, type TxnType } from "./types";

export type JournalDraftLine = {
  accountId: string;
  categoryId: string | null;
  debitCents: number;
  creditCents: number;
  sortOrder: number;
  docTypeCode: DocTypeCode;
};

export type JournalDraft = {
  docTypeCode: DocTypeCode;
  lines: JournalDraftLine[];
};

export function buildJournalEntry(input: {
  type: TxnType;
  amountCents: number;
  settlementAccountId: string;
  categoryAccountId: string;
  categoryId: string;
}): JournalDraft {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error("Amount must be a non-negative number of cents.");
  }
  if (input.settlementAccountId === input.categoryAccountId) {
    throw new Error("The settlement account and the category account must be different.");
  }
  const docTypeCode = docTypeFor(input.type);
  const amount = input.amountCents;
  if (input.type === "sales") {
    return {
      docTypeCode,
      lines: [
        {
          accountId: input.settlementAccountId,
          categoryId: null,
          debitCents: amount,
          creditCents: 0,
          sortOrder: 0,
          docTypeCode
        },
        {
          accountId: input.categoryAccountId,
          categoryId: input.categoryId,
          debitCents: 0,
          creditCents: amount,
          sortOrder: 1,
          docTypeCode
        }
      ]
    };
  }
  return {
    docTypeCode,
    lines: [
      {
        accountId: input.categoryAccountId,
        categoryId: input.categoryId,
        debitCents: amount,
        creditCents: 0,
        sortOrder: 0,
        docTypeCode
      },
      {
        accountId: input.settlementAccountId,
        categoryId: null,
        debitCents: 0,
        creditCents: amount,
        sortOrder: 1,
        docTypeCode
      }
    ]
  };
}

export function entryIsBalanced(lines: Array<{ debitCents: number; creditCents: number }>): boolean {
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
  return debit === credit;
}
