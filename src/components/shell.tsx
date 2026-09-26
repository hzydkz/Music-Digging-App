"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LibraryItem } from "@/lib/queries";
import { Navigator } from "./navigator";

const LibraryContext = createContext<LibraryItem[]>([]);
export const useLibrary = () => useContext(LibraryContext);

/**
 * 폭 ≥ 1024px: 왼쪽 320px 패널(검색 + 라이브러리) + 오른쪽 본문 2단.
 * 폭 < 1024px: 1단, 패널은 왼쪽 드로어.
 */
export function Shell({ library, children }: { library: LibraryItem[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <LibraryContext.Provider value={library}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[320px_1fr]">
        {/* 가로: 고정 왼쪽 패널 */}
        <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:pt-[env(safe-area-inset-top)] lg:pl-[env(safe-area-inset-left)]">
          <Navigator />
        </aside>

        {/* 세로: 상단 바 + 드로어 */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-xl"
            aria-label="검색과 라이브러리 열기"
          >
            ☰
          </button>
          <Link href="/" className="flex h-11 items-center font-semibold">
            디깅 노트
          </Link>
        </header>
        {open && (
          <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="닫기"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col bg-surface pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] shadow-xl">
              <Navigator onClose={() => setOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-8 lg:pr-[max(2rem,env(safe-area-inset-right))]">
          {children}
        </main>
      </div>
    </LibraryContext.Provider>
  );
}
