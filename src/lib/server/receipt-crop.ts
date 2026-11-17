import sharp from "sharp";
import { cropRect, type ReceiptBox } from "$lib/accounting/receipt-layout";

export type PreparedReceiptImage = {
  full: Buffer;
  preview: Buffer;
  width: number;
  height: number;
};

export async function prepareReceiptImage(bytes: Buffer): Promise<PreparedReceiptImage> {
  const full = await sharp(bytes, { failOn: "none", pages: 1 }).rotate().jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(full).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 8 || height < 8) throw new Error("The photo is too small to separate.");
  const preview = await sharp(full)
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { full, preview, width, height };
}

export async function cropReceiptBoxes(
  full: Buffer,
  boxes: ReceiptBox[],
  imageWidth: number,
  imageHeight: number
): Promise<Buffer[]> {
  const crops: Buffer[] = [];
  for (const box of boxes) {
    const rect = cropRect(box, imageWidth, imageHeight);
    if (rect.width < 8 || rect.height < 8) throw new Error("A receipt outline was too small to crop.");
    const bytes = await sharp(full).extract(rect).jpeg({ quality: 86 }).toBuffer();
    if (bytes.length === 0) throw new Error("A receipt crop was empty.");
    crops.push(bytes);
  }
  return crops;
}
