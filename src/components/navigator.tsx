"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLibrary } from "./shell";

interface Candidate {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  type: string;
  saved: boolean;
}

export function Navigator({ onClose, inline = false }: { onClose?: () => void; inline?: boolean }) {
  const library = useLibrary();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "검색 실패");
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function open(c: Candidate) {
    if (c.saved) {
      router.push(`/release/${c.mbid}`);
      return;
    }
    setOpening(c.mbid);
    setError(null);
    try {
      const res = await fetch("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mbid: c.mbid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      router.push(`/release/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${inline ? "" : "h-full"}`}>
      <div className={`flex items-center justify-between px-4 pt-4 pb-2 ${inline ? "hidden" : ""}`}>
        <Link href="/" className="text-lg font-bold">
          디깅 노트
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-muted"
            aria-label="닫기"
          >
            ✕
          </button>
        )}
      </div>

      <form onSubmit={search} className={`flex gap-2 px-4 pb-3 ${inline ? "pt-4" : ""}`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="앨범명, 또는 아티스트 - 앨범명"
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-11 shrink-0 rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50"
        >
          {busy ? "…" : "검색"}
        </button>
      </form>
      {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}

      <div className={`min-h-0 flex-1 ${inline ? "" : "overflow-y-auto overscroll-contain"} pb-[env(safe-area-inset-bottom)]`}>
        {results ? (
          <section>
            <div className="flex items-center justify-between px-4 py-1">
              <h2 className="text-sm font-semibold text-muted">MusicBrainz 검색 결과</h2>
              <button
                type="button"
                onClick={() => setResults(null)}
                className="h-11 px-2 text-sm text-accent"
              >
                라이브러리로
              </button>
            </div>
            {results.length === 0 && <p className="px-4 py-2 text-muted">결과가 없습니다.</p>}
            <ul>
              {results.map((c) => (
                <li key={c.mbid}>
                  <button
                    type="button"
                    onClick={() => open(c)}
                    disabled={opening !== null}
                    className="flex min-h-14 w-full flex-col items-start px-4 py-2 text-left active:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="font-medium leading-snug">
                      {c.title}
                      {c.saved && (
                        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">저장됨</span>
                      )}
                    </span>
                    <span className="text-sm text-muted">
                      {c.artist} · {c.year ?? "연도 미상"} · {c.type}
                      {opening === c.mbid && " · 불러오는 중…"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section>
            <h2 className="px-4 py-1 text-sm font-semibold text-muted">내 라이브러리 · 최근 본 순</h2>
            {library.length === 0 && (
              <p className="px-4 py-2 text-sm text-muted">아직 저장된 앨범이 없습니다. 위에서 검색해 보세요.</p>
            )}
            <ul>
              {library.map((item) => {
                const active = pathname === `/release/${item.id}`;
                return (
                  <li key={item.id}>
                    <Link
                      href={`/release/${item.id}`}
                      className={`flex min-h-14 flex-col justify-center px-4 py-2 ${active ? "bg-surface-2" : "active:bg-surface-2"}`}
                    >
                      <span className="font-medium leading-snug">{item.title}</span>
                      <span className="text-sm text-muted">
                        {item.artistCredit}
                        {item.year ? ` · ${item.year}` : ""}
                        {item.noteStatus !== "ready" && " · 노트 없음"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {!inline && (
        <div className="flex gap-1 border-t border-line px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <Link href="/settings" className="flex h-11 items-center px-3 text-sm text-muted">
            설정
          </Link>
          <button
            type="button"
            className="h-11 px-3 text-sm text-muted"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.replace("/login");
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
