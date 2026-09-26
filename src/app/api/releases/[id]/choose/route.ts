import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { FETCH_SOURCES, chooseCandidate, type FetchSource } from "@/lib/pipeline";

/** 매칭 후보 선택. choice가 null이면 이 소스를 건너뛴다. */
export async function POST(req: Request, ctx: RouteContext<"/api/releases/[id]/choose">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { source?: string; choice?: string | number | null };
  if (!FETCH_SOURCES.includes(body.source as FetchSource)) return jsonError("잘못된 소스입니다.", 400);
  return handle(async () => {
    await chooseCandidate(getDb(), id, body.source as FetchSource, body.choice ?? null);
    return { ok: true };
  });
}
