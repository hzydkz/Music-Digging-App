/**
 * 단일 비밀번호 인증.
 * 세션 쿠키 값 = `<만료시각ms>.<HMAC-SHA256(만료시각, SESSION_SECRET)>`
 * Web Crypto만 사용하므로 proxy와 라우트 핸들러 양쪽에서 쓸 수 있다.
 */

export const SESSION_COOKIE = "digging_session";
export const SESSION_MAX_AGE_SEC = 90 * 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Buffer.from(sig).toString("base64url");
}

/** 길이가 달라도 비교 시간이 입력 내용에 좌우되지 않도록 해시끼리 비교한다. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function createSessionToken(
  secret: string,
  nowMs = Date.now(),
): Promise<string> {
  const exp = String(nowMs + SESSION_MAX_AGE_SEC * 1000);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  return safeEqual(sig, await hmac(secret, exp));
}
