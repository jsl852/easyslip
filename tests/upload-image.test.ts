import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UPLOAD_JPEG_QUALITIES,
  UPLOAD_MAX_EDGE,
  exifAlreadyApplied,
  fittedSize,
  orientedPixelSize,
  readJpegMeta,
  shouldReworkImage
} from "../src/lib/upload-image";
import { MAX_FILE_BYTES } from "../src/lib/uploads";

function jpegWithOrientation(orientation: number, width: number, height: number): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  tiff[2] = 0x2a;
  tiff[4] = 8;
  tiff[8] = 1;
  tiff[10] = 0x12;
  tiff[11] = 0x01;
  tiff[12] = 3;
  tiff[14] = 1;
  tiff[18] = orientation;
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  payload.set(tiff, 6);
  const app1 = new Uint8Array(4 + payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  const size = payload.length + 2;
  app1[2] = size >> 8;
  app1[3] = size & 0xff;
  app1.set(payload, 4);
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00
  ]);
  const bytes = new Uint8Array(2 + app1.length + sof.length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes.set(app1, 2);
  bytes.set(sof, 2 + app1.length);
  return bytes;
}

describe("client image sizing", () => {
  it("shrinks a long edge to 2400px and does not upscale", () => {
    const large = fittedSize(4032, 3024);
    expect(UPLOAD_MAX_EDGE).toBe(2400);
    expect(Math.max(large.width, large.height)).toBe(2400);
    expect(large.scale).toBeLessThan(1);
    expect(fittedSize(1200, 800)).toEqual({ width: 1200, height: 800, scale: 1 });
    expect(UPLOAD_JPEG_QUALITIES[0]).toBe(0.85);
  });

  it("reworks oversized or huge photos and leaves a small jpeg alone", () => {
    expect(
      shouldReworkImage({ heic: false, allowed: true, size: 2_000_000, width: 4032, height: 3024, maxBytes: MAX_FILE_BYTES })
    ).toBe(true);
    expect(
      shouldReworkImage({ heic: false, allowed: true, size: 400_000, width: 1600, height: 1200, maxBytes: MAX_FILE_BYTES })
    ).toBe(false);
    expect(
      shouldReworkImage({ heic: true, allowed: false, size: 400_000, width: 800, height: 600, maxBytes: MAX_FILE_BYTES })
    ).toBe(true);
    expect(
      shouldReworkImage({ heic: false, allowed: true, size: MAX_FILE_BYTES + 1, width: 800, height: 600, maxBytes: MAX_FILE_BYTES })
    ).toBe(true);
  });

  it("reads JPEG EXIF orientation and the unrotated size", () => {
    const meta = readJpegMeta(jpegWithOrientation(6, 4032, 3024));
    expect(meta).toEqual({ orientation: 6, width: 4032, height: 3024 });
    expect(orientedPixelSize(meta.width ?? 0, meta.height ?? 0, meta.orientation)).toEqual({ width: 3024, height: 4032 });
    expect(exifAlreadyApplied(3024, 4032, 4032, 3024, 6)).toBe(true);
    expect(exifAlreadyApplied(4032, 3024, 4032, 3024, 6)).toBe(false);
    expect(readJpegMeta(new Uint8Array([1, 2, 3])).orientation).toBe(1);
  });

  it("shows compressing progress on the upload screen and does not rewrite PDFs there", () => {
    const page = readFileSync("src/routes/app/upload/+page.svelte", "utf8");
    const prepare = readFileSync("src/lib/upload-prepare.ts", "utf8");
    expect(page).toContain("Compressing photos…");
    expect(page).toContain('aria-live="polite"');
    expect(prepare).toContain("application/pdf");
    expect(prepare).toContain("return file");
  });
});
