export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BATCH = 20;

const allowed = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AllowedMime = (typeof allowed)[number];

export function sniffMime(buffer: Buffer): AllowedMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("utf8") === "%PDF-") return "application/pdf";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("utf8");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("utf8") === "RIFF" &&
    buffer.subarray(8, 12).toString("utf8") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "document";
  const cleaned = base.replace(/[^\w.\- ()+\u3400-\u9fff]+/g, "_").slice(0, 180);
  return cleaned || "document";
}

export function asBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
