import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { usage } from "@/db/schema";
import { llmConfig } from "@/lib/llm";
import { monthSpend, monthlyBudget } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const KEYS: Array<[string, string]> = [
  ["APP_PASSWORD", "로그인 비밀번호"],
  ["SESSION_SECRET", "세션 서명 키"],
  ["TURSO_DATABASE_URL", "Turso DB 주소"],
  ["TURSO_AUTH_TOKEN", "Turso 토큰"],
  ["ANTHROPIC_API_KEY", "Claude API 키"],
  ["DISCOGS_TOKEN", "Discogs 토큰"],
  ["MB_CONTACT", "MusicBrainz 연락처(User-Agent)"],
];

export default async function SettingsPage() {
  const db = getDb();
  const [spend, recent] = await Promise.all([
    monthSpend(db),
    db.select().from(usage).orderBy(desc(usage.date)).limit(14),
  ]);
  const budget = monthlyBudget();
  const cfg = llmConfig();
  const env = process.env.VERCEL_ENV ?? "local";

  return (
    <div className="mx-auto max-w-[720px] space-y-8 py-6">
      <h1 className="text-2xl font-bold">설정</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold">연결 상태</h2>
        <p className="mb-2 text-sm text-muted">배포 환경: {env} (키 값은 표시하지 않습니다)</p>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {KEYS.map(([k, label]) => {
            const set = Boolean(process.env[k]?.trim());
            const optional = k === "ANTHROPIC_API_KEY";
            return (
              <li key={k} className="flex min-h-11 items-center justify-between px-4 py-2">
                <span>
                  {label} <span className="text-sm text-muted">{k}</span>
                </span>
                <span className={set ? "text-ok" : optional ? "text-muted" : "text-danger"}>
                  {set ? "설정됨" : optional ? "없음 (수동 모드)" : "없음"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Claude API 사용량</h2>
        <p className="mb-1 text-sm text-muted">
          수동 모드(claude.ai에 붙여넣기)로 만든 노트는 API를 쓰지 않아 여기 집계되지 않습니다.
        </p>
        <p>
          모델 <code>{cfg.model}</code> · effort <code>{cfg.effort}</code> · 폴백 {cfg.fallbacks ? "켜짐" : "꺼짐"}
        </p>
        <p className="mt-1">
          이번 달 예상 비용 <strong>${spend.toFixed(3)}</strong>
          {budget !== null ? ` / 예산 $${budget.toFixed(2)}` : " (MONTHLY_BUDGET_USD 미설정)"}
        </p>
        <p className="mt-1 text-sm text-muted">
          토큰 수 × 공개 단가로 계산한 추정치입니다. 실제 청구액은 Anthropic Console에서 확인하세요.
        </p>
        {recent.length > 0 && (
          <table className="mt-3 w-full text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">날짜(UTC)</th>
                <th className="py-1 text-right font-normal">입력</th>
                <th className="py-1 text-right font-normal">출력</th>
                <th className="py-1 text-right font-normal">비용</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((u) => (
                <tr key={u.date} className="border-t border-line">
                  <td className="py-1">{u.date}</td>
                  <td className="py-1 text-right">{u.inputTokens.toLocaleString()}</td>
                  <td className="py-1 text-right">{u.outputTokens.toLocaleString()}</td>
                  <td className="py-1 text-right">${u.estCost.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
