import { describe, expect, it } from "vitest";
import { addUploadFiles, isAllowedUpload, isHeicFile, MAX_BATCH, MAX_FILE_BYTES } from "../src/lib/uploads";

function file(name: string, size: number, type: string) {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

describe("receipt selection", () => {
  it("keeps camera photos and library files together up to the batch limit", () => {
    const first = addUploadFiles([], [file("image.jpg", 1200, "image/jpeg")]);
    const second = addUploadFiles(first.files, [file("invoice.pdf", 800, "application/pdf"), file("notes.txt", 10, "text/plain")]);
    expect(second.files.map((item) => item.name)).toEqual(["image.jpg", "invoice.pdf"]);
    expect(second.message).toMatch(/PDF, JPEG/);
  });

  it("rejects a HEIC photo the browser could not convert", () => {
    const result = addUploadFiles([], [file("IMG_2043.HEIC", 4000, "image/heic")]);
    expect(result.files).toHaveLength(0);
    expect(result.message).toMatch(/HEIC/);
    expect(isHeicFile(file("shot.heif", 10, ""))).toBe(true);
  });

  it("rejects an image over 8 MB and stops at 20 files", () => {
    const oversized = addUploadFiles([], [file("huge.jpg", MAX_FILE_BYTES + 1, "image/jpeg")]);
    expect(oversized.files).toHaveLength(0);
    expect(oversized.message).toMatch(/8 MB/);

    const existing = Array.from({ length: MAX_BATCH }, (_, index) => file(`r${index}.jpg`, 100, "image/jpeg"));
    const full = addUploadFiles(existing, [file("one-more.jpg", 100, "image/jpeg")]);
    expect(full.files).toHaveLength(MAX_BATCH);
    expect(full.message).toMatch(/20/);
  });

  it("accepts an empty-type file when the extension is a receipt", () => {
    expect(isAllowedUpload(file("2024-03-02_cafe_86.50.jpg", 100, ""))).toBe(true);
    expect(isAllowedUpload(file("slip.webp", 100, "image/webp"))).toBe(true);
  });
});
