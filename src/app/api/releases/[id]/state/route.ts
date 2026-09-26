import { getDb } from "@/db/client";
import { handle } from "@/lib/api";
import { getRunState } from "@/lib/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/releases/[id]/state">) {
  const { id } = await ctx.params;
  return handle(async () => ({ state: await getRunState(getDb(), id) }));
}
