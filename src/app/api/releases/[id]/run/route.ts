import { getDb } from "@/db/client";
import { handle } from "@/lib/api";
import { runNextJob } from "@/lib/pipeline";
import { getRunState } from "@/lib/queries";

// LLM 요약 job이 이 시간 안에 끝나야 한다. 플랜별 최대값은 Vercel 문서를 확인할 것.
export const maxDuration = 300;

/** 실행 가능한 job 하나를 실행하고 현재 상태를 돌려준다. 브라우저가 반복 호출한다. */
export async function POST(_req: Request, ctx: RouteContext<"/api/releases/[id]/run">) {
  const { id } = await ctx.params;
  return handle(async () => {
    const db = getDb();
    const { ran } = await runNextJob(db, id);
    return { ran: ran ? `${ran.type}:${ran.target}` : null, state: await getRunState(db, id) };
  });
}
