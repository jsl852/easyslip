export const MAX_RECEIPTS_PER_PHOTO = 6;

export type ReceiptBox = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReceiptPlan =
  | { action: "single" }
  | { action: "split"; boxes: ReceiptBox[] }
  | { action: "unseparated"; count: number; reason: string };

const MIN_SIDE = 0.05;
const MIN_AREA = 0.02;
const SAME_SLIP_OVERLAP = 0.7;

export function planReceiptSplit(value: unknown): ReceiptPlan {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!row) return { action: "single" };
  const count = finiteCount(row.count);
  if (count === null || count < 2) return { action: "single" };

  if (count > MAX_RECEIPTS_PER_PHOTO) {
    return {
      action: "unseparated",
      count,
      reason: `${count} receipts found in one photo. EasySlip separates up to ${MAX_RECEIPTS_PER_PHOTO} slips. Upload them in smaller photos so none are skipped.`
    };
  }

  const confident = row.confident === true;
  const rawBoxes = Array.isArray(row.receipts) ? row.receipts : [];
  const boxes = rawBoxes.map(readBox).filter((box): box is ReceiptBox => box !== null);
  const distinct = dropDuplicates(boxes);

  if (!confident || distinct.length !== count) {
    return { action: "unseparated", count, reason: unseparatedReason(count, confident, distinct.length) };
  }

  return { action: "split", boxes: sortBoxes(distinct) };
}

export function receiptSplitCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { kind?: unknown; count?: unknown };
  if (row.kind !== "receipt-split" || typeof row.count !== "number" || !Number.isInteger(row.count) || row.count < 2) {
    return null;
  }
  return row.count;
}

export function splitReceiptFileName(label: string, index: number, total: number): string {
  const safe = label
    .toLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${safe || "receipt"}-${index}-of-${total}.jpg`;
}

export function cropRect(
  box: ReceiptBox,
  imageWidth: number,
  imageHeight: number
): { left: number; top: number; width: number; height: number } {
  const padX = Math.round(imageWidth * 0.012);
  const padY = Math.round(imageHeight * 0.012);
  const left = clamp(Math.floor(box.x * imageWidth) - padX, 0, Math.max(0, imageWidth - 1));
  const top = clamp(Math.floor(box.y * imageHeight) - padY, 0, Math.max(0, imageHeight - 1));
  const width = clamp(Math.round(box.width * imageWidth) + padX * 2, 1, imageWidth - left);
  const height = clamp(Math.round(box.height * imageHeight) + padY * 2, 1, imageHeight - top);
  return { left, top, width, height };
}

function unseparatedReason(count: number, confident: boolean, usable: number): string {
  const found = `${count} receipts found`;
  if (!confident) {
    return `${found}, but the edges were not clear enough to separate them. Nothing was dropped. Open the photo, or upload each slip on its own.`;
  }
  if (usable < count) {
    return `${found}, but only ${usable} could be outlined without mixing them. Nothing was dropped. Open the photo, or upload each slip on its own.`;
  }
  return `${found}, but the photo included extra outlines. Nothing was dropped. Open the photo, or upload each slip on its own.`;
}

function finiteCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function readBox(value: unknown): ReceiptBox | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const coords = [row.x, row.y, row.width, row.height];
  if (!coords.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const scale = coords.some((item) => (item as number) > 1) ? 0.01 : 1;
  let x = (row.x as number) * scale;
  let y = (row.y as number) * scale;
  let width = (row.width as number) * scale;
  let height = (row.height as number) * scale;
  x = clamp(x, 0, 1);
  y = clamp(y, 0, 1);
  width = clamp(width, 0, 1 - x);
  height = clamp(height, 0, 1 - y);
  if (width < MIN_SIDE || height < MIN_SIDE || width * height < MIN_AREA) return null;
  const label = typeof row.label === "string" ? row.label.trim().slice(0, 80) : "";
  return { label, x, y, width, height };
}

function dropDuplicates(boxes: ReceiptBox[]): ReceiptBox[] {
  const kept: ReceiptBox[] = [];
  const ordered = [...boxes].sort((a, b) => area(b) - area(a));
  for (const box of ordered) {
    const duplicate = kept.some((other) => overlapRatio(box, other) > SAME_SLIP_OVERLAP);
    if (!duplicate) kept.push(box);
  }
  return kept;
}

function sortBoxes(boxes: ReceiptBox[]): ReceiptBox[] {
  return [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
}

function area(box: ReceiptBox): number {
  return box.width * box.height;
}

function overlapRatio(a: ReceiptBox, b: ReceiptBox): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  const smaller = Math.min(area(a), area(b));
  if (smaller <= 0) return 0;
  return intersection / smaller;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
