import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { apiAvailable, startNote } from "@/lib/pipeline";

/** 자동: "노트 자동 생성" / "다시 생성". 수동: "자료 모으기" (수집만) */
export async function POST(req: Request, ctx: RouteContext<"/api/releases/[id]/note">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    force?: boolean;
    refetch?: boolean;
    mode?: "auto" | "manual";
  };
  const mode = body.mode === "manual" ? "manual" : "auto";
  if (mode === "auto" && !apiAvailable()) {
    return jsonError("ANTHROPIC_API_KEY가 없어 자동 생성을 쓸 수 없습니다. 수동 모드를 쓰세요.", 400);
  }
  return handle(() =>
    startNote(getDb(), id, { force: !!body.force, refetch: !!body.refetch, mode }),
  );
}
