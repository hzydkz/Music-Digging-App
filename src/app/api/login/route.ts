import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC, createSessionToken, safeEqual } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) {
    return jsonError("APP_PASSWORD / SESSION_SECRET 환경변수가 설정되지 않았습니다.", 500);
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!(await safeEqual(body.password ?? "", password))) {
    // 무차별 대입을 느리게 만든다.
    await new Promise((r) => setTimeout(r, 1000));
    return jsonError("비밀번호가 맞지 않습니다.", 401);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
