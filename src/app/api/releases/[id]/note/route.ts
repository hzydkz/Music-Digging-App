import { getDb } from "@/db/client";
import { handle } from "@/lib/api";
import { startNote } from "@/lib/pipeline";

/** "노트 만들기" / "다시 생성" */
export async function POST(req: Request, ctx: RouteContext<"/api/releases/[id]/note">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; refetch?: boolean };
  return handle(() => startNote(getDb(), id, { force: !!body.force, refetch: !!body.refetch }));
}
