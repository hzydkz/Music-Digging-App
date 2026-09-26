"use client";

import { useState } from "react";

/** Cover Art Archive 이미지. 없으면(404) 기본 아이콘. */
export function Cover({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(!src);
  return (
    <div className="aspect-square w-full overflow-hidden rounded-xl bg-surface-2">
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-5xl text-muted" aria-label="커버 없음">
          ◎
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
