import { isIsoDate } from "./dates";
import { toCents } from "./money";
import type { ExtractResult } from "./types";

/** A match has to clear this before two receipts become one expense on their own. */
export const AUTO_MERGE_CONFIDENCE = 0.9;

/** At or above this, and at or below the auto-merge line, the pair is only suggested. */
export const SUGGEST_CONFIDENCE = 0.7;

const AMOUNT_WEIGHT = 0.4;
const SAME_DAY_WEIGHT = 0.3;
const ONE_DAY_WEIGHT = 0.216;
const TWO_DAY_WEIGHT = 0.105;
const MERCHANT_WEIGHT = 0.18;
const COMPLEMENT_WEIGHT = 0.12;

const STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "food",
  "sale",
  "shop",
  "hong",
  "kong",
  "ltd",
  "limited",
  "company",
  "paid",
  "visa",
  "card",
  "with",
  "from",
  "that",
  "this",
  "meal",
  "receipt",
  "invoice",
  "copy",
  "merchant",
  "beverages",
  "entertainment",
  "hang",
  "seng"
]);

const CARD_PATTERNS = [
  /\bvisa\b/i,
  /mastercard/i,
  /master card/i,
  /\bamex\b/i,
  /american express/i,
  /unionpay/i,
  /銀聯/,
  /cardholder/i,
  /merchant copy/i,
  /customer copy/i,
  /approval code/i,
  /auth(?:orization)? code/i,
  /visa sale/i,
  /card slip/i,
  /hang seng/i,
  /恒生/
];

const ITEMIZED_PATTERNS = [
  /service charge/i,
  /服務費/,
  /\bpasta\b/i,
  /oyster/i,
  /egg tart/i,
  /meal for/i,
  /restaurant meal/i,
  /\bqty\b/i,
  /\bquantity\b/i,
  /\bsubtotal\b/i,
  /小計/,
  /itemized/i,
  /\b\d+\s*[x×]\s/i
];

const PAYMENT_LABELS: Array<[RegExp, string]> = [
  [/\bvisa\b/i, "Visa"],
  [/mastercard|master card/i, "Mastercard"],
  [/american express|\bamex\b/i, "Amex"],
  [/unionpay|銀聯/i, "UnionPay"],
  [/\bkpay\b/i, "Kpay"],
  [/alipay|支付寶/i, "Alipay"],
  [/wechat|微信支付/i, "WeChat Pay"],
  [/octopus|八達通/i, "Octopus"],
  [/\bfps\b|轉數快/i, "FPS"],
  [/\bcash\b|現金/i, "Cash"]
];

export type DocumentKind = "itemized" | "card_slip" | "unknown";
export type ReceiptRole = "primary" | "payment" | "support";

export type ReceiptEvidence = {
  id: string;
  txnDate: string | null;
  merchant: string;
  description: string;
  amountCents: number | null;
  currency: string;
};

export type PairScore = {
  confidence: number;
  reason: string;
  leftKind: DocumentKind;
  rightKind: DocumentKind;
};

export type GroupAction = "merge" | "suggest" | "separate";

export type ReceiptGroup = {
  ids: string[];
  confidence: number;
  reason: string;
  primaryId: string;
};

export type ReceiptSuggestion = {
  leftId: string;
  rightId: string;
  confidence: number;
  reason: string;
};

export function actionForConfidence(confidence: number): GroupAction {
  if (confidence > AUTO_MERGE_CONFIDENCE) return "merge";
  if (confidence >= SUGGEST_CONFIDENCE) return "suggest";
  return "separate";
}

export function classifyDocument(text: string): DocumentKind {
  const card = CARD_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const itemized = ITEMIZED_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (card === 0 && itemized === 0) return "unknown";
  if (card > itemized) return "card_slip";
  if (itemized > card) return "itemized";
  return "unknown";
}

export function kindsComplement(left: DocumentKind, right: DocumentKind): boolean {
  return (left === "itemized" && right === "card_slip") || (left === "card_slip" && right === "itemized");
}

export function paymentLabelFromText(text: string): string | null {
  for (const [pattern, label] of PAYMENT_LABELS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function paymentLabelForReceipts(items: Array<{ kind: DocumentKind; text: string }>): string | null {
  const card = items.find((item) => item.kind === "card_slip");
  if (card) {
    const label = paymentLabelFromText(card.text);
    if (label) return label;
  }
  for (const item of items) {
    const label = paymentLabelFromText(item.text);
    if (label) return label;
  }
  return null;
}

export function evidenceFromExtract(id: string, extract: ExtractResult): ReceiptEvidence {
  let amountCents: number | null = null;
  if (extract.amount != null && extract.amount !== "") {
    try {
      amountCents = toCents(extract.amount);
    } catch {
      amountCents = null;
    }
  }
  const currency = /^[A-Za-z]{3}$/.test(extract.currency ?? "") ? extract.currency.toUpperCase() : "HKD";
  return {
    id,
    txnDate: extract.txnDate || null,
    merchant: extract.merchant ?? "",
    description: extract.description ?? "",
    amountCents,
    currency
  };
}

export function readExtract(value: unknown): ExtractResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ExtractResult>;
  if (row.source !== "xai" && row.source !== "stub") return null;
  if (typeof row.txnDate !== "string" || typeof row.description !== "string") return null;
  return {
    source: row.source,
    txnDate: row.txnDate,
    merchant: typeof row.merchant === "string" ? row.merchant : "",
    description: row.description,
    amount: typeof row.amount === "string" ? row.amount : null,
    currency: typeof row.currency === "string" ? row.currency : "HKD",
    suggestedCategory: typeof row.suggestedCategory === "string" ? row.suggestedCategory : null,
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((item): item is string => typeof item === "string") : [],
    ...(typeof row.model === "string" ? { model: row.model } : {})
  };
}

export function scoreReceiptPair(left: ReceiptEvidence, right: ReceiptEvidence): PairScore {
  const leftKind = classifyDocument(`${left.merchant} ${left.description}`);
  const rightKind = classifyDocument(`${right.merchant} ${right.description}`);
  const empty: PairScore = { confidence: 0, reason: "The amounts do not match, so these stay separate expenses.", leftKind, rightKind };
  if (left.amountCents == null || right.amountCents == null || left.amountCents <= 0 || right.amountCents <= 0) {
    return empty;
  }
  if (left.amountCents !== right.amountCents || left.currency !== right.currency) return empty;

  let confidence = AMOUNT_WEIGHT;
  const notes = ["same amount and currency"];
  const days = dayDistance(left.txnDate, right.txnDate);
  if (days === 0) {
    confidence += SAME_DAY_WEIGHT;
    notes.push("same date");
  } else if (days === 1) {
    confidence += ONE_DAY_WEIGHT;
    notes.push("dates one day apart");
  } else if (days === 2) {
    confidence += TWO_DAY_WEIGHT;
    notes.push("dates two days apart");
  }

  if (merchantsOverlap(left.merchant, right.merchant)) {
    confidence += MERCHANT_WEIGHT;
    notes.push("merchant name overlaps");
  }

  if (kindsComplement(leftKind, rightKind)) {
    confidence += COMPLEMENT_WEIGHT;
    notes.push("one slip is an itemized bill and the other is card or payment evidence");
  }

  confidence = Math.round(confidence * 10000) / 10000;
  const reason = `Possible same purchase: ${notes.join(", ")}.`;
  return { confidence, reason, leftKind, rightKind };
}

export function planReceiptGroups(receipts: ReceiptEvidence[]): { groups: ReceiptGroup[]; suggestions: ReceiptSuggestion[] } {
  const ids = receipts.map((receipt) => receipt.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const edges: Array<{ leftId: string; rightId: string; score: PairScore }> = [];

  for (let index = 0; index < receipts.length; index += 1) {
    for (let other = index + 1; other < receipts.length; other += 1) {
      const score = scoreReceiptPair(receipts[index], receipts[other]);
      if (score.confidence <= 0) continue;
      edges.push({ leftId: receipts[index].id, rightId: receipts[other].id, score });
      if (score.confidence > AUTO_MERGE_CONFIDENCE) union(parent, receipts[index].id, receipts[other].id);
    }
  }

  const byRoot = new Map<string, ReceiptEvidence[]>();
  for (const receipt of receipts) {
    const root = find(parent, receipt.id);
    const list = byRoot.get(root) ?? [];
    list.push(receipt);
    byRoot.set(root, list);
  }

  const groups: ReceiptGroup[] = [];
  for (const members of byRoot.values()) {
    const memberIds = new Set(members.map((member) => member.id));
    const inside = edges.filter(
      (edge) => memberIds.has(edge.leftId) && memberIds.has(edge.rightId) && edge.score.confidence > AUTO_MERGE_CONFIDENCE
    );
    const best = inside.reduce<PairScore | null>((current, edge) => {
      if (!current || edge.score.confidence > current.confidence) return edge.score;
      return current;
    }, null);
    const weakest = inside.reduce<number | null>((current, edge) => {
      if (current == null || edge.score.confidence < current) return edge.score.confidence;
      return current;
    }, null);
    groups.push({
      ids: members.map((member) => member.id),
      confidence: weakest ?? 0,
      reason: best?.reason ?? "",
      primaryId: choosePrimary(members).id
    });
  }

  const suggestions: ReceiptSuggestion[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.score.confidence > AUTO_MERGE_CONFIDENCE || edge.score.confidence < SUGGEST_CONFIDENCE) continue;
    if (find(parent, edge.leftId) === find(parent, edge.rightId)) continue;
    const key = canonicalExpensePair(edge.leftId, edge.rightId).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const [leftId, rightId] = canonicalExpensePair(edge.leftId, edge.rightId);
    suggestions.push({ leftId, rightId, confidence: edge.score.confidence, reason: edge.score.reason });
  }

  return { groups, suggestions };
}

export function choosePrimary(receipts: ReceiptEvidence[]): ReceiptEvidence {
  const ranked = [...receipts].sort((left, right) => {
    const kind = kindRank(classifyDocument(`${right.merchant} ${right.description}`)) - kindRank(classifyDocument(`${left.merchant} ${left.description}`));
    if (kind !== 0) return kind;
    return right.description.length - left.description.length;
  });
  return ranked[0];
}

export function roleFor(kind: DocumentKind, primary: boolean): ReceiptRole {
  if (primary) return "primary";
  if (kind === "card_slip") return "payment";
  return "support";
}

export function canonicalExpensePair(leftId: string, rightId: string): [string, string] {
  return leftId < rightId ? [leftId, rightId] : [rightId, leftId];
}

function kindRank(kind: DocumentKind): number {
  if (kind === "itemized") return 3;
  if (kind === "unknown") return 2;
  return 1;
}

function merchantsOverlap(left: string, right: string): boolean {
  const leftTokens = merchantTokens(left);
  const rightTokens = merchantTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function merchantTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().normalize("NFKC");
  const latin = normalized.match(/[a-z0-9]{3,}/g) ?? [];
  const cjk = normalized.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const tokens = new Set<string>();
  for (const token of [...latin, ...cjk]) {
    if (!STOP_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

function dayDistance(left: string | null, right: string | null): number | null {
  if (!left || !right || !isIsoDate(left) || !isIsoDate(right)) return null;
  const ms = Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`);
  return Math.round(Math.abs(ms) / 86_400_000);
}

function find(parent: Map<string, string>, id: string): string {
  let current = id;
  while (parent.get(current) !== current) {
    const next = parent.get(current);
    if (!next) return current;
    current = next;
  }
  return current;
}

function union(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot === rightRoot) return;
  if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot);
  else parent.set(leftRoot, rightRoot);
}
