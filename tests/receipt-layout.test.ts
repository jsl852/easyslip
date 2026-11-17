import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropRect, planReceiptSplit, splitReceiptFileName } from "../src/lib/accounting/receipt-layout";
import { cropReceiptBoxes, prepareReceiptImage } from "../src/lib/server/receipt-crop";

const sideBySide = {
  count: 2,
  confident: true,
  receipts: [
    { label: "Restaurant bill", x: 0.02, y: 0.01, width: 0.46, height: 0.97 },
    { label: "Card merchant copy", x: 0.52, y: 0.06, width: 0.4, height: 0.62 }
  ]
};

describe("receipt split planning", () => {
  it("keeps a single receipt on the existing path", () => {
    expect(planReceiptSplit({ count: 1, confident: true, receipts: [] })).toEqual({ action: "single" });
    expect(planReceiptSplit({ count: 1, confident: true, receipts: [{ label: "bill", x: 0, y: 0, width: 1, height: 1 }] })).toEqual({
      action: "single"
    });
    expect(planReceiptSplit(null)).toEqual({ action: "single" });
  });

  it("plans a separate crop for each side-by-side slip", () => {
    const plan = planReceiptSplit(sideBySide);
    expect(plan.action).toBe("split");
    if (plan.action !== "split") return;
    expect(plan.boxes.map((box) => box.label)).toEqual(["Restaurant bill", "Card merchant copy"]);
    expect(plan.boxes[0]?.x).toBeLessThan(plan.boxes[1]?.x ?? 0);
  });

  it("accepts percentage boxes", () => {
    const plan = planReceiptSplit({
      count: 2,
      confident: true,
      receipts: [
        { label: "left", x: 2, y: 1, width: 46, height: 97 },
        { label: "right", x: 52, y: 6, width: 40, height: 62 }
      ]
    });
    expect(plan.action).toBe("split");
  });

  it("does not drop a second slip when the outlines overlap too much to crop", () => {
    const plan = planReceiptSplit({
      count: 2,
      confident: true,
      receipts: [
        { label: "a", x: 0.1, y: 0.1, width: 0.7, height: 0.8 },
        { label: "b", x: 0.2, y: 0.15, width: 0.65, height: 0.75 }
      ]
    });
    expect(plan.action).toBe("unseparated");
    if (plan.action !== "unseparated") return;
    expect(plan.count).toBe(2);
    expect(plan.reason).toMatch(/2 receipts found/);
    expect(plan.reason).toMatch(/Nothing was dropped/);
  });

  it("keeps an unsure multi-receipt photo whole and visible", () => {
    const plan = planReceiptSplit({ count: 2, confident: false, receipts: sideBySide.receipts });
    expect(plan.action).toBe("unseparated");
    if (plan.action !== "unseparated") return;
    expect(plan.reason).toMatch(/not clear enough/);
  });

  it("refuses to crop a subset when the model finds more slips than it outlines", () => {
    const plan = planReceiptSplit({ count: 3, confident: true, receipts: sideBySide.receipts });
    expect(plan.action).toBe("unseparated");
    if (plan.action !== "unseparated") return;
    expect(plan.count).toBe(3);
    expect(plan.reason).toMatch(/only 2/);
  });

  it("does not silently skip slips beyond the per-photo limit", () => {
    const plan = planReceiptSplit({
      count: 8,
      confident: true,
      receipts: Array.from({ length: 8 }, (_, index) => ({
        label: `slip ${index}`,
        x: (index % 4) * 0.25,
        y: index < 4 ? 0 : 0.5,
        width: 0.24,
        height: 0.48
      }))
    });
    expect(plan.action).toBe("unseparated");
    if (plan.action !== "unseparated") return;
    expect(plan.reason).toMatch(/8 receipts found/);
    expect(plan.reason).toMatch(/none are skipped/);
  });

  it("names each crop and keeps the crop inside the photo", () => {
    expect(splitReceiptFileName("Card merchant copy", 2, 2)).toBe("card-merchant-copy-2-of-2.jpg");
    const rect = cropRect({ label: "", x: 0, y: 0, width: 0.5, height: 1 }, 100, 80);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.left + rect.width).toBeLessThanOrEqual(100);
    expect(rect.top + rect.height).toBeLessThanOrEqual(80);
  });
});

describe("upload status copy", () => {
  it("shows how many receipts were found and keeps an unseparated photo retryable", () => {
    const page = readFileSync("src/routes/app/upload/+page.svelte", "utf8");
    expect(page).toContain("receipts found");
    expect(page).toContain("needs_split");
    expect(page).toContain("Each slip is listed on its own");
  });
});

describe("receipt cropping", () => {
  it("crops a side-by-side photo into two distinct images", async () => {
    const width = 240;
    const height = 100;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        if (x < width / 2) pixels[offset] = 230;
        else pixels[offset + 2] = 230;
      }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
    const prepared = await prepareReceiptImage(source);
    const crops = await cropReceiptBoxes(
      prepared.full,
      [
        { label: "left", x: 0.04, y: 0.08, width: 0.4, height: 0.84 },
        { label: "right", x: 0.56, y: 0.08, width: 0.4, height: 0.84 }
      ],
      prepared.width,
      prepared.height
    );
    expect(crops).toHaveLength(2);
    const left = await sharp(crops[0]).stats();
    const right = await sharp(crops[1]).stats();
    expect(left.channels[0]?.mean).toBeGreaterThan(left.channels[2]?.mean ?? 0);
    expect(right.channels[2]?.mean).toBeGreaterThan(right.channels[0]?.mean ?? 0);
  });
});
