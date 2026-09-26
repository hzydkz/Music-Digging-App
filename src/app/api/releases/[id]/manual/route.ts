import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { saveManualNote } from "@/lib/pipeline";

const MAX_LEN = 60_000;

/** 수동 모드: claude.ai 답변을 붙여넣어 저장 */
export async function POST(req: Request, ctx: RouteContext<"/api/releases/[id]/manual">) {
  const { id } = await ctx.params;
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return jsonError("붙여넣은 내용이 없습니다.", 400);
  if (text.length > MAX_LEN) return jsonError("내용이 너무 깁니다.", 400);
  return handle(async () => {
    await saveManualNote(getDb(), id, text);
    return { ok: true };
  });
}
