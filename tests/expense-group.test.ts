import { describe, expect, it } from "vitest";
import {
  actionForConfidence,
  AUTO_MERGE_CONFIDENCE,
  canonicalExpensePair,
  classifyDocument,
  evidenceFromExtract,
  paymentLabelForReceipts,
  planReceiptGroups,
  scoreReceiptPair,
  SUGGEST_CONFIDENCE,
  type ReceiptEvidence
} from "../src/lib/accounting/expense-group";
import type { ExtractResult } from "../src/lib/accounting/types";

const cardText = "Food and beverages, Visa sale at Owens, Shop G02 G/F Maritime Square Tsing Yi";
const billText = "Restaurant meal for 2 (pasta, oysters, egg tart, cake) plus 10% service charge; paid by Kpay";

function evidence(id: string, patch: Partial<ReceiptEvidence>): ReceiptEvidence {
  return {
    id,
    txnDate: "2026-10-13",
    merchant: "Cafe",
    description: "Coffee",
    amountCents: 8000,
    currency: "HKD",
    ...patch
  };
}

function extract(patch: Partial<ExtractResult>): ExtractResult {
  return {
    source: "xai",
    txnDate: "2026-10-13",
    merchant: "",
    description: "",
    amount: "363.00",
    currency: "HKD",
    suggestedCategory: "Meals and entertainment",
    confidence: 0.92,
    warnings: [],
    ...patch
  };
}

describe("receipt grouping", () => {
  it("auto-merges the Owens itemized bill and Hang Seng Visa slip above 90%", () => {
    const card = evidenceFromExtract(
      "card",
      extract({ merchant: "OWENS", description: cardText })
    );
    const bill = evidenceFromExtract(
      "bill",
      extract({ merchant: "Owens (青衣)", description: billText })
    );

    expect(classifyDocument(`${card.merchant} ${card.description}`)).toBe("card_slip");
    expect(classifyDocument(`${bill.merchant} ${bill.description}`)).toBe("itemized");

    const score = scoreReceiptPair(card, bill);
    expect(score.confidence).toBeGreaterThan(AUTO_MERGE_CONFIDENCE);
    expect(actionForConfidence(score.confidence)).toBe("merge");

    const plan = planReceiptGroups([card, bill]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].ids.sort()).toEqual(["bill", "card"]);
    expect(plan.groups[0].primaryId).toBe("bill");
    expect(plan.groups[0].confidence).toBeGreaterThan(0.9);
    expect(plan.suggestions).toEqual([]);
    expect(paymentLabelForReceipts([
      { kind: "itemized", text: `${bill.merchant} ${bill.description}` },
      { kind: "card_slip", text: `${card.merchant} ${card.description}` }
    ])).toBe("Visa");
  });

  it("does not auto-merge at exactly 90%, or when the slips are not complementary", () => {
    expect(actionForConfidence(AUTO_MERGE_CONFIDENCE)).toBe("suggest");
    expect(actionForConfidence(AUTO_MERGE_CONFIDENCE + 0.0001)).toBe("merge");
    expect(actionForConfidence(SUGGEST_CONFIDENCE - 0.01)).toBe("separate");
    expect(actionForConfidence(SUGGEST_CONFIDENCE)).toBe("suggest");

    const left = evidence("left", { merchant: "Cafe", description: "Coffee" });
    const right = evidence("right", { merchant: "Cafe", description: "Coffee" });
    const score = scoreReceiptPair(left, right);
    expect(score.confidence).toBeLessThanOrEqual(AUTO_MERGE_CONFIDENCE);
    expect(actionForConfidence(score.confidence)).toBe("suggest");
    const plan = planReceiptGroups([left, right]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.suggestions).toHaveLength(1);
  });

  it("suggests a same-day same-amount pair with different merchants and does not drop either receipt", () => {
    const cafe = evidence("cafe", { merchant: "Cafe", description: "Coffee" });
    const bakery = evidence("bakery", { merchant: "Bakery", description: "Bread" });
    const plan = planReceiptGroups([cafe, bakery]);
    const ids = plan.groups.flatMap((group) => group.ids).sort();
    expect(ids).toEqual(["bakery", "cafe"]);
    expect(plan.groups.every((group) => group.ids.length === 1)).toBe(true);
    expect(plan.suggestions).toEqual([
      expect.objectContaining({ leftId: "bakery", rightId: "cafe" })
    ]);
    expect(plan.suggestions[0].confidence).toBeGreaterThanOrEqual(SUGGEST_CONFIDENCE);
    expect(plan.suggestions[0].confidence).toBeLessThanOrEqual(AUTO_MERGE_CONFIDENCE);
  });

  it("leaves different amounts as separate expenses with no suggestion", () => {
    const left = evidence("left", { amountCents: 36300, merchant: "Owens" });
    const right = evidence("right", { amountCents: 12000, merchant: "Owens" });
    const plan = planReceiptGroups([left, right]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.suggestions).toEqual([]);
    expect(scoreReceiptPair(left, right).confidence).toBe(0);
  });

  it("keeps every receipt when three slips are only partly the same purchase", () => {
    const bill = evidenceFromExtract("bill", extract({ merchant: "Owens (青衣)", description: billText }));
    const card = evidenceFromExtract("card", extract({ merchant: "OWENS", description: cardText }));
    const other = evidence("other", { merchant: "Bakery", description: "Bread", amountCents: 36300 });
    const plan = planReceiptGroups([bill, card, other]);
    expect(plan.groups.flatMap((group) => group.ids).sort()).toEqual(["bill", "card", "other"]);
    const merged = plan.groups.find((group) => group.ids.length > 1);
    expect(merged?.ids.sort()).toEqual(["bill", "card"]);
    expect(plan.suggestions.some((item) => item.leftId === "other" || item.rightId === "other")).toBe(true);
  });

  it("stores a suggestion pair in one order", () => {
    expect(canonicalExpensePair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalExpensePair("a", "b")).toEqual(["a", "b"]);
  });
});
