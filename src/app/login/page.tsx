import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold">디깅 노트</h1>
        <p className="mb-6 text-muted">비밀번호를 입력하세요.</p>
        <LoginForm next={target} />
      </div>
    </main>
  );
}
