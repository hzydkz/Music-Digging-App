"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.replace(next);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "로그인에 실패했습니다.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-[17px] outline-none focus:border-accent"
        aria-label="비밀번호"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="h-12 w-full rounded-xl bg-accent font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
