import {
  UPLOAD_JPEG_QUALITIES,
  exifAlreadyApplied,
  fittedSize,
  orientedPixelSize,
  readJpegMeta,
  shouldReworkImage
} from "$lib/upload-image";
import { isAllowedUpload, isHeicFile, MAX_FILE_BYTES } from "$lib/uploads";

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "receipt";
  return `${base}.jpg`;
}

function blobToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function decodeForOrientation(file: File): Promise<{ bitmap: ImageBitmap; baked: boolean }> {
  try {
    return { bitmap: await createImageBitmap(file, { imageOrientation: "none" }), baked: false };
  } catch {
    try {
      return { bitmap: await createImageBitmap(file, { imageOrientation: "from-image" }), baked: true };
    } catch {
      return { bitmap: await createImageBitmap(file), baked: true };
    }
  }
}

function drawOriented(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  orientation: number,
  scale: number
) {
  const width = bitmap.width;
  const height = bitmap.height;
  ctx.scale(scale, scale);
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
  ctx.drawImage(bitmap, 0, 0);
}

/**
 * Shrink a large receipt photo in the browser before upload.
 * The whole photo is kept, including every slip in the frame, so the server can split it later.
 * PDFs are returned unchanged.
 */
export async function prepareUploadFile(file: File): Promise<File> {
  const image =
    isHeicFile(file) || file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (!image || file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = readJpegMeta(bytes);
    const heic = isHeicFile(file);
    const decoded = heic
      ? {
          bitmap: await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file)),
          baked: true
        }
      : await decodeForOrientation(file);
    bitmap = decoded.bitmap;
    const baked =
      decoded.baked ||
      (meta.width !== null &&
        meta.height !== null &&
        exifAlreadyApplied(bitmap.width, bitmap.height, meta.width, meta.height, meta.orientation));
    const orientation = baked ? 1 : meta.orientation;
    const oriented = orientedPixelSize(bitmap.width, bitmap.height, orientation);
    if (
      !shouldReworkImage({
        heic,
        allowed: isAllowedUpload(file),
        size: file.size,
        width: oriented.width,
        height: oriented.height,
        maxBytes: MAX_FILE_BYTES
      })
    ) {
      return file;
    }

    const fit = fittedSize(oriented.width, oriented.height);
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawOriented(ctx, bitmap, orientation, fit.scale);

    let chosen: Blob | null = null;
    for (const quality of UPLOAD_JPEG_QUALITIES) {
      const blob = await blobToJpeg(canvas, quality);
      if (!blob) continue;
      chosen = blob;
      if (blob.size <= MAX_FILE_BYTES) break;
    }
    if (!chosen || chosen.size > MAX_FILE_BYTES) return file;
    if (chosen.size >= file.size && file.size <= MAX_FILE_BYTES && isAllowedUpload(file) && !heic) return file;
    return new File([chosen], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
