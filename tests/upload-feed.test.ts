import { describe, expect, it } from "vitest";
import { foldUploadFeed, uploadReadingCount, type UploadFeedRow } from "../src/lib/accounting/upload-feed";

function row(patch: Partial<UploadFeedRow["receipt"]>, expense: UploadFeedRow["expense"] = null): UploadFeedRow {
  return {
    receipt: {
      id: "receipt",
      fileName: "slip.jpg",
      mimeType: "image/jpeg",
      status: "extracted",
      extractionSource: "xai",
      error: null,
      createdAt: "2026-10-13T10:00:00.000Z",
      parentFileName: null,
      receiptCount: null,
      documentKind: "unknown",
      expenseId: null,
      ...patch
    },
    expense
  };
}

describe("upload feed", () => {
  it("shows one expense for the Owens bill and the card slip", () => {
    const expense = {
      id: "expense-1",
      description: "Owens (青衣) — Restaurant meal for 2",
      merchant: "Owens (青衣)",
      amount: "363.00",
      txnDate: "2026-10-13",
      reviewStatus: "needs_review",
      extractionSource: "xai",
      groupConfidence: "1.000"
    };
    const items = foldUploadFeed([
      row(
        { id: "card", fileName: "card.jpg", documentKind: "card_slip", expenseId: expense.id, createdAt: "2026-10-13T10:02:00.000Z" },
        expense
      ),
      row(
        { id: "bill", fileName: "bill.jpg", documentKind: "itemized", expenseId: expense.id, createdAt: "2026-10-13T10:01:00.000Z" },
        expense
      ),
      row({ id: "parent", status: "split", fileName: "photo.jpg", receiptCount: 2 })
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("expense");
    if (items[0].kind !== "expense") return;
    expect(items[0].id).toBe("expense-1");
    expect(items[0].amount).toBe("363.00");
    expect(items[0].receipts.map((receipt) => receipt.id)).toEqual(["bill", "card"]);
  });

  it("keeps a failed receipt visible and counts receipts that are still reading", () => {
    const items = foldUploadFeed([
      row({ id: "failed", status: "failed", error: "Extraction failed before a journal entry could be posted." }),
      row({ id: "queued", status: "queued", createdAt: "2026-10-14T10:00:00.000Z" })
    ]);
    expect(items.map((item) => (item.kind === "receipt" ? item.receipt.id : item.id))).toEqual(["queued", "failed"]);
    expect(uploadReadingCount(items)).toBe(1);
  });
});
