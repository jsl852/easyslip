import { listReviewQueue } from "$lib/server/books";
import { getDb } from "$lib/server/db/client";
import { workspaceOf } from "$lib/server/workspace";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, parent }) => {
  const workspace = workspaceOf(locals);
  const { counts } = await parent();
  const queue = await listReviewQueue(getDb(), workspace.company.id);
  return { queue, queued: counts.queued };
};
