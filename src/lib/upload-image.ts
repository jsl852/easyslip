/** Longest side after a client resize. Small photos are not enlarged. */
export const UPLOAD_MAX_EDGE = 2400;

/** First JPEG quality. Lower steps are used only when the file is still over the 8 MB limit. */
export const UPLOAD_JPEG_QUALITIES = [0.85, 0.8, 0.72] as const;

export type JpegMeta = {
  orientation: number;
  width: number | null;
  height: number | null;
};

export function fittedSize(width: number, height: number, maxEdge = UPLOAD_MAX_EDGE) {
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}

export function orientedPixelSize(width: number, height: number, orientation: number) {
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
  return { width, height };
}

export function shouldReworkImage(input: {
  heic: boolean;
  allowed: boolean;
  size: number;
  width: number;
  height: number;
  maxBytes: number;
}): boolean {
  if (input.heic || !input.allowed || input.size > input.maxBytes) return true;
  return Math.max(input.width, input.height) > UPLOAD_MAX_EDGE;
}

/** True when the bitmap dimensions already match a 90-degree EXIF orientation. */
export function exifAlreadyApplied(
  bitmapWidth: number,
  bitmapHeight: number,
  storedWidth: number,
  storedHeight: number,
  orientation: number
): boolean {
  if (orientation < 5 || orientation > 8 || storedWidth === storedHeight) return false;
  return bitmapWidth === storedHeight && bitmapHeight === storedWidth;
}

export function readJpegMeta(bytes: Uint8Array): JpegMeta {
  const meta: JpegMeta = { orientation: 1, width: null, height: null };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return meta;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + 2 + size > bytes.length) break;
    const body = bytes.subarray(offset + 4, offset + 2 + size);
    if (marker === 0xe1) {
      const orientation = orientationInExif(body);
      if (orientation) meta.orientation = orientation;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && body.length >= 7) {
      meta.height = (body[1] << 8) | body[2];
      meta.width = (body[3] << 8) | body[4];
    }
    offset += 2 + size;
  }
  return meta;
}

function orientationInExif(segment: Uint8Array): number | null {
  if (segment.length < 14) return null;
  if (
    segment[0] !== 0x45 ||
    segment[1] !== 0x78 ||
    segment[2] !== 0x69 ||
    segment[3] !== 0x66 ||
    segment[4] !== 0 ||
    segment[5] !== 0
  ) {
    return null;
  }
  const view = segment.subarray(6);
  const little = view[0] === 0x49 && view[1] === 0x49;
  const big = view[0] === 0x4d && view[1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (offset: number) =>
    little ? (view[offset] ?? 0) | ((view[offset + 1] ?? 0) << 8) : ((view[offset] ?? 0) << 8) | (view[offset + 1] ?? 0);
  const u32 = (offset: number) =>
    little
      ? (view[offset] ?? 0) |
        ((view[offset + 1] ?? 0) << 8) |
        ((view[offset + 2] ?? 0) << 16) |
        ((view[offset + 3] ?? 0) << 24)
      : ((view[offset] ?? 0) << 24) |
        ((view[offset + 1] ?? 0) << 16) |
        ((view[offset + 2] ?? 0) << 8) |
        (view[offset + 3] ?? 0);
  if (u16(2) !== 0x002a) return null;
  return orientationInIfd(u32(4), 0);

  function orientationInIfd(ifd: number, depth: number): number | null {
    if (depth > 2 || ifd <= 0 || ifd + 2 > view.length) return null;
    const count = u16(ifd);
    let exifPointer: number | null = null;
    for (let index = 0; index < count; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (entry + 12 > view.length) return null;
      const tag = u16(entry);
      if (tag === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
      if (tag === 0x8769) exifPointer = u32(entry + 8);
    }
    return exifPointer === null ? null : orientationInIfd(exifPointer, depth + 1);
  }
}
