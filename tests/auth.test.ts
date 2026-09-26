import { describe, expect, it } from "vitest";
import { createSessionToken, safeEqual, verifySessionToken } from "@/lib/auth";

describe("session token", () => {
  it("서명한 토큰은 검증된다", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "secret")).toBe(true);
  });
  it("다른 비밀키, 변조, 만료는 거부된다", async () => {
    const t = await createSessionToken("secret", 1_000);
    expect(await verifySessionToken(t, "secret", 2_000)).toBe(true);
    expect(await verifySessionToken(t, "other", 2_000)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1}.${sig}`, "secret", 2_000)).toBe(false);
    expect(await verifySessionToken(t, "secret", Number(exp) + 1)).toBe(false);
    expect(await verifySessionToken(undefined, "secret")).toBe(false);
    expect(await verifySessionToken(t, undefined)).toBe(false);
  });
  it("safeEqual", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });
});
