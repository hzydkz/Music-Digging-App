import { describe, expect, it } from "vitest";
import { buildManualPrompt, parseManualNote } from "@/lib/llm";

describe("manual mode", () => {
  it("프롬프트에 규칙, 답변 형식, 원문이 모두 들어간다", () => {
    const p = buildManualPrompt(
      { title: "OK Computer", artist: "Radiohead", year: 1997 },
      [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/OK_Computer", text: "BODY TEXT" }],
      [{ termEn: "shoegaze", termKo: "슈게이징", note: null }],
    );
    expect(p).toContain("<source> 안에 있는 내용만 서술합니다");
    expect(p).toContain("## 한 줄 요약");
    expect(p).toContain("## 제작 배경");
    expect(p).toContain('<source name="Wikipedia" url="https://en.wikipedia.org/wiki/OK_Computer">\nBODY TEXT');
    expect(p).toContain("shoegaze → 슈게이징");
    expect(p).toContain("답변 형식을 지켜 주세요");
    expect(p).not.toContain("summary:");
  });

  it("답변 파싱: 앞뒤 잡담, 소제목(###), 제목 표기 차이 허용", () => {
    const text = [
      "네, 정리했습니다.",
      "",
      "## 한 줄 요약",
      "Radiohead의 세 번째 앨범이다 [Wikipedia].",
      "",
      "# 제작 배경:",
      "### 녹음",
      "St Catherine's Court에서 녹음했다 [Wikipedia].",
      "",
      "둘째 문단 [Discogs].",
    ].join("\r\n");
    const r = parseManualNote(text);
    expect(r.summary).toBe("Radiohead의 세 번째 앨범이다 [Wikipedia].");
    expect(r.background).toBe("### 녹음\nSt Catherine's Court에서 녹음했다 [Wikipedia].\n\n둘째 문단 [Discogs].");
  });

  it("굵게 표시한 제목도 인식, 한쪽만 있으면 그쪽만", () => {
    const r = parseManualNote("**제작 배경**\n내용 [Wikipedia]");
    expect(r).toEqual({ summary: "", background: "내용 [Wikipedia]" });
  });

  it("제목이 없으면 오류", () => {
    expect(() => parseManualNote("그냥 아무 글")).toThrow("제목을 찾지 못했습니다");
    // 본문 중간의 '제작 배경'이라는 단어는 제목으로 보지 않는다
    expect(() => parseManualNote("이 앨범의 제작 배경은 복잡하다")).toThrow();
  });
});
