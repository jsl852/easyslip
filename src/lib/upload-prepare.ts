import { isAllowedUpload, isHeicFile, MAX_FILE_BYTES } from "$lib/uploads";

const MAX_EDGE = 2200;

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "receipt";
  return `${base}.jpg`;
}

async function decode(file: File, width?: number, height?: number): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { imageOrientation: "from-image" };
  if (width && height) {
    options.resizeWidth = width;
    options.resizeHeight = height;
    options.resizeQuality = "high";
  }
  try {
    return await createImageBitmap(file, options);
  } catch {
    return await createImageBitmap(file);
  }
}

function blobToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Turn HEIC photos and oversized images into a JPEG the upload limit will accept. */
export async function prepareUploadFile(file: File): Promise<File> {
  const heic = isHeicFile(file);
  const image = heic || file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|hei[cf])$/i.test(file.name);
  if (!image || (!heic && file.size <= MAX_FILE_BYTES && isAllowedUpload(file))) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decode(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale < 1) {
      bitmap.close();
      bitmap = await decode(file, width, height);
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    let blob: Blob | null = null;
    for (const quality of [0.86, 0.72, 0.58]) {
      blob = await blobToJpeg(canvas, quality);
      if (blob && blob.size <= MAX_FILE_BYTES) break;
    }
    if (!blob) return file;
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
