import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";

/**
 * 서버리스 인스턴스 간에 공유되는 호출 간격 제한.
 * rate_state 행을 "마지막 호출이 intervalMs 이전일 때만" 원자적으로 갱신해서 슬롯을 얻는다.
 * 슬롯을 못 얻으면 남은 시간만큼 기다렸다가 다시 시도한다.
 */
export async function acquireSlot(
  db: DB,
  source: string,
  intervalMs: number,
  { maxWaitMs = 15_000, sleep = defaultSleep } = {},
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  await db.run(
    sql`INSERT INTO rate_state (source, last_called_at) VALUES (${source}, 0) ON CONFLICT(source) DO NOTHING`,
  );
  while (true) {
    const now = Date.now();
    const claimed = await db.all<{ source: string }>(
      sql`UPDATE rate_state SET last_called_at = ${now}
          WHERE source = ${source} AND last_called_at <= ${now - intervalMs}
          RETURNING source`,
    );
    if (claimed.length > 0) return;

    const rows = await db.all<{ last_called_at: number }>(
      sql`SELECT last_called_at FROM rate_state WHERE source = ${source}`,
    );
    const last = rows[0]?.last_called_at ?? 0;
    const wait = Math.max(50, last + intervalMs - now);
    if (now + wait > deadline) {
      throw new Error(`${source} 요청 대기 시간이 초과되었습니다. 잠시 후 다시 시도하세요.`);
    }
    await sleep(wait);
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
