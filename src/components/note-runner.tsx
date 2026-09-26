"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunState } from "@/lib/queries";

const SOURCE_NAMES: Record<string, string> = {
  musicbrainz: "MusicBrainz",
  wikipedia: "Wikipedia",
  discogs: "Discogs",
};
const JOB_NAMES: Record<string, string> = {
  "fetch:wikipedia": "Wikipedia 수집",
  "fetch:discogs": "Discogs 수집",
  "summarize:album": "한국어 노트 작성",
};
const STATUS_NAMES: Record<string, string> = {
  pending: "대기",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  waiting: "선택 필요",
  ok: "성공",
  not_found: "자료 없음",
  needs_choice: "선택 필요",
};

/** 실행 중이거나 지금 실행할 수 있는 job이 있는가 (사용자 선택 대기로 막힌 경우는 제외) */
function busyOf(s: RunState) {
  if (s.jobs.some((j) => j.status === "running")) return true;
  const fetches = s.jobs.filter((j) => j.type === "fetch");
  if (fetches.some((j) => j.status === "pending")) return true;
  const settled = fetches.every((j) => j.status === "done" || j.status === "failed");
  return settled && s.jobs.some((j) => j.type === "summarize" && j.status === "pending");
}

async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}

/**
 * "노트 만들기" 버튼 + job 실행 루프.
 * 페이지가 열려 있는 동안 /run을 반복 호출한다. 페이지를 닫으면 멈추고, 다시 열면 이어서 진행한다.
 */
export function NoteRunner({ releaseId, initial }: { releaseId: string; initial: RunState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const looping = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loop = useCallback(async () => {
    if (looping.current) return;
    looping.current = true;
    setError(null);
    try {
      let idlePolls = 0;
      while (alive.current) {
        const data = (await post(`/api/releases/${releaseId}/run`)) as { ran: string | null; state: RunState };
        setState(data.state);
        if (data.ran) {
          idlePolls = 0;
          router.refresh();
          continue;
        }
        const running = data.state.jobs.some((j) => j.status === "running");
        // 다른 탭/인스턴스가 실행 중인 job이 있으면 잠시 기다렸다 다시 확인
        if (running && idlePolls < 150) {
          idlePolls++;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      looping.current = false;
      router.refresh();
    }
  }, [releaseId, router]);

  // 다시 열었을 때 남은 job부터 이어서 진행
  useEffect(() => {
    if (busyOf(initial)) loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(opts: { refetch?: boolean } = {}) {
    setError(null);
    try {
      let res = await post(`/api/releases/${releaseId}/note`, opts);
      if (!res.ok && res.reason === "budget") {
        const go = window.confirm(
          `이번 달 예상 비용 $${res.spend.toFixed(2)}가 예산 $${res.budget.toFixed(2)}에 도달했습니다. 그래도 생성할까요?`,
        );
        if (!go) return;
        res = await post(`/api/releases/${releaseId}/note`, { ...opts, force: true });
      }
      await loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function choose(source: string, choice: string | number | null) {
    try {
      await post(`/api/releases/${releaseId}/choose`, { source, choice });
      await loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function retry(source: string) {
    try {
      await post(`/api/releases/${releaseId}/retry`, { source });
      await loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = busyOf(state) || looping.current;
  const hasJobs = state.jobs.length > 0;
  const choices = state.sources.filter((s) => s.status === "needs_choice" && s.candidates.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!hasJobs ? (
          <button
            type="button"
            onClick={() => start()}
            className="h-11 rounded-xl bg-accent px-5 font-semibold text-accent-fg"
          >
            노트 만들기
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => start()}
              className="h-11 rounded-xl border border-line bg-surface px-4 font-medium disabled:opacity-50"
            >
              다시 생성
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("소스를 다시 수집한 뒤 노트를 새로 만듭니다. 진행할까요?")) start({ refetch: true });
              }}
              className="h-11 rounded-xl border border-line bg-surface px-4 font-medium disabled:opacity-50"
            >
              소스부터 다시
            </button>
          </>
        )}
        {busy && <span className="text-sm text-muted">진행 중… 이 화면을 열어 두세요.</span>}
      </div>
      {!hasJobs && (
        <p className="text-sm text-muted">
          버튼을 누르면 Wikipedia·Discogs 자료를 모아 Claude API로 한국어 노트를 만듭니다(API 요금 발생).
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {choices.map((s) => (
        <div key={s.source} className="rounded-xl border border-accent/50 bg-surface p-4">
          <p className="mb-2 font-semibold">
            {SOURCE_NAMES[s.source] ?? s.source}: 어느 문서가 이 앨범인가요?
          </p>
          <p className="mb-3 text-sm text-muted">자동으로 확정하기엔 애매해서 멈췄습니다. 다른 앨범을 요약하지 않도록 직접 골라 주세요.</p>
          <ul className="space-y-1">
            {s.candidates.map((c) => (
              <li key={String(c.value)}>
                <button
                  type="button"
                  onClick={() => choose(s.source, c.value)}
                  className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left active:bg-surface-2"
                >
                  <span className="font-medium">{c.label}</span>
                  {c.detail && <span className="line-clamp-2 text-sm text-muted">{c.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => choose(s.source, null)}
            className="mt-2 h-11 px-3 text-sm text-muted"
          >
            해당 없음 (이 소스 건너뛰기)
          </button>
        </div>
      ))}

      {hasJobs && (
        <details className="rounded-xl border border-line bg-surface px-4 py-2" open={busy || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">진행 상황 · 소스 상태</summary>
          <ul className="mb-2 space-y-1 text-sm">
            {state.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-x-3">
                <span>{JOB_NAMES[`${j.type}:${j.target}`] ?? `${j.type}:${j.target}`}</span>
                <span className={j.status === "failed" ? "text-danger" : j.status === "done" ? "text-ok" : "text-muted"}>
                  {STATUS_NAMES[j.status] ?? j.status}
                </span>
                {j.error && <span className="w-full text-danger">{j.error}</span>}
              </li>
            ))}
          </ul>
          <ul className="space-y-1 border-t border-line pt-2 text-sm">
            {state.sources.map((s) => (
              <li key={s.source} className="flex flex-wrap items-center justify-between gap-x-3">
                <span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {SOURCE_NAMES[s.source] ?? s.source}
                    </a>
                  ) : (
                    (SOURCE_NAMES[s.source] ?? s.source)
                  )}
                  <span className="ml-2 text-muted">{new Date(s.fetchedAt).toLocaleString("ko-KR")}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={s.status === "failed" ? "text-danger" : s.status === "ok" ? "text-ok" : "text-muted"}>
                    {STATUS_NAMES[s.status] ?? s.status}
                  </span>
                  {(s.status === "failed" || s.status === "not_found") && s.source !== "musicbrainz" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => retry(s.source)}
                      className="h-11 rounded-lg px-3 text-accent disabled:opacity-50"
                    >
                      다시 시도
                    </button>
                  )}
                </span>
                {s.error && <span className="w-full text-danger">{s.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
