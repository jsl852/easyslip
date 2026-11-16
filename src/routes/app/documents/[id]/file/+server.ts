import { error } from "@sveltejs/kit";
import { getDb } from "$lib/server/db/client";
import { readDocumentFile } from "$lib/server/documents";
import { workspaceOf } from "$lib/server/workspace";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params }) => {
  const workspace = workspaceOf(locals);
  const file = await readDocumentFile(getDb(), workspace.company.id, params.id);
  if (!file) throw error(404, "Document not found.");
  const ascii = file.fileName.replace(/[^\w.\-]+/g, "_") || "document";
  return new Response(new Uint8Array(file.fileData), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
};
