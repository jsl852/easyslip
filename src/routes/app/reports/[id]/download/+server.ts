import { error } from "@sveltejs/kit";
import { getDb } from "$lib/server/db/client";
import { getReportFile } from "$lib/server/reports";
import { asBuffer } from "$lib/server/files";
import { workspaceOf } from "$lib/server/workspace";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params }) => {
  const workspace = workspaceOf(locals);
  const file = await getReportFile(getDb(), workspace.company.id, params.id);
  if (!file) throw error(404, "Report not found.");
  const bytes = asBuffer(file.fileData);
  const ascii = file.fileName.replace(/[^\w.\-]+/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
};
