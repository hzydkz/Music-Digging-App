import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { FETCH_SOURCES, retrySource, type FetchSource } from "@/lib/pipeline";

export async function POST(req: Request, ctx: RouteContext<"/api/releases/[id]/retry">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { source?: string };
  if (!FETCH_SOURCES.includes(body.source as FetchSource)) return jsonError("잘못된 소스입니다.", 400);
  return handle(async () => {
    await retrySource(getDb(), id, body.source as FetchSource);
    return { ok: true };
  });
}
