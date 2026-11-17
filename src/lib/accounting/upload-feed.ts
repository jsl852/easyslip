export type UploadReceiptCard = {
  id: string;
  fileName: string;
  mimeType: string;
  status: string;
  extractionSource: string | null;
  error: string | null;
  createdAt: string;
  parentFileName: string | null;
  receiptCount: number | null;
  documentKind: string | null;
  expenseId: string | null;
};

export type UploadExpenseFields = {
  id: string;
  description: string;
  merchant: string;
  amount: string;
  txnDate: string;
  reviewStatus: string;
  extractionSource: string;
  groupConfidence: string | null;
};

export type UploadFeedRow = {
  receipt: UploadReceiptCard;
  expense: UploadExpenseFields | null;
};

export type UploadExpenseCard = UploadExpenseFields & {
  kind: "expense";
  receipts: UploadReceiptCard[];
  sortAt: string;
};

export type UploadLooseCard = {
  kind: "receipt";
  receipt: UploadReceiptCard;
  sortAt: string;
};

export type UploadFeedItem = UploadExpenseCard | UploadLooseCard;

const KIND_ORDER: Record<string, number> = { itemized: 0, unknown: 1, card_slip: 2 };

export function foldUploadFeed(rows: UploadFeedRow[]): UploadFeedItem[] {
  const expenses = new Map<string, UploadExpenseCard>();
  const loose: UploadLooseCard[] = [];

  for (const row of rows) {
    if (row.receipt.status === "split") continue;
    if (row.receipt.expenseId && row.expense && row.expense.id === row.receipt.expenseId) {
      const current = expenses.get(row.expense.id);
      if (current) {
        current.receipts.push(row.receipt);
        if (row.receipt.createdAt > current.sortAt) current.sortAt = row.receipt.createdAt;
      } else {
        expenses.set(row.expense.id, {
          kind: "expense",
          ...row.expense,
          receipts: [row.receipt],
          sortAt: row.receipt.createdAt
        });
      }
      continue;
    }
    loose.push({ kind: "receipt", receipt: row.receipt, sortAt: row.receipt.createdAt });
  }

  for (const card of expenses.values()) {
    card.receipts.sort((left, right) => {
      const kind = (KIND_ORDER[left.documentKind ?? "unknown"] ?? 1) - (KIND_ORDER[right.documentKind ?? "unknown"] ?? 1);
      if (kind !== 0) return kind;
      return left.createdAt < right.createdAt ? -1 : 1;
    });
  }

  return [...expenses.values(), ...loose].sort((left, right) => (left.sortAt < right.sortAt ? 1 : -1));
}

export function uploadReadingCount(items: UploadFeedItem[]): number {
  const receipts = items.flatMap((item) => (item.kind === "expense" ? item.receipts : [item.receipt]));
  return receipts.filter((receipt) => receipt.status === "queued" || receipt.status === "processing").length;
}
