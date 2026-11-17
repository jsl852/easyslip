export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BATCH = 20;

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.hei[cf]$/i.test(file.name);
}

export function isAllowedUpload(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type.toLowerCase())) return true;
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(file.name);
}

export function addUploadFiles(existing: readonly File[], incoming: Iterable<File> | null): { files: File[]; message: string | null } {
  if (!incoming) return { files: [...existing], message: null };
  const next = [...existing];
  const problems: string[] = [];
  for (const file of incoming) {
    if (file.size <= 0) continue;
    if (isHeicFile(file)) {
      problems.push(`${file.name} is a HEIC photo this browser could not convert. Use Take photo, or save a JPEG.`);
      continue;
    }
    if (!isAllowedUpload(file)) {
      problems.push(`${file.name} needs to be a PDF, JPEG, PNG, GIF, or WebP.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`${file.name} is larger than 8 MB.`);
      continue;
    }
    if (next.length >= MAX_BATCH) {
      problems.push(`Upload up to ${MAX_BATCH} files at a time.`);
      break;
    }
    next.push(file);
  }
  return { files: next, message: problems[0] ?? null };
}
