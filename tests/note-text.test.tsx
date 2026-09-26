import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteText } from "@/components/note-text";

const sources = [
  { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/X" },
  { label: "Discogs", url: null },
];
const html = (text: string) =>
  renderToStaticMarkup(<NoteText text={text} sources={sources} />).replace(/<a [^>]*>/g, "<a>");

describe("NoteText", () => {
  it("배지 뒤 마침표를 배지 앞으로 옮긴다", () => {
    expect(html("녹음했다 [Wikipedia]. 다음 문장")).toBe(
      '<div class="prose-note"><p>녹음했다. <span class="whitespace-nowrap"><a>Wikipedia</a></span> 다음 문장</p></div>',
    );
  });
  it("이미 마침표 뒤에 있으면 그대로", () => {
    expect(html("녹음했다. [Wikipedia]")).toBe(
      '<div class="prose-note"><p>녹음했다. <span class="whitespace-nowrap"><a>Wikipedia</a></span></p></div>',
    );
  });
  it("여러 소스, 모르는 대괄호는 글자 그대로", () => {
    expect(html("참여했다 [Wikipedia, Discogs]. [미확인]")).toContain(
      '참여했다. <span class="whitespace-nowrap"><a>Wikipedia</a><span class="cite">Discogs</span></span>',
    );
    expect(html("[미확인] 글")).toContain("[미확인] 글");
  });
});

describe("emphasis", () => {
  it("*기울임*, _기울임_, **굵게**", () => {
    expect(html("*The Low End Theory*는 두 번째 앨범이다. [Wikipedia]")).toContain(
      "<em>The Low End Theory</em>는 두 번째 앨범이다.",
    );
    expect(html("데뷔 앨범 _People's Instinctive Travels_이 나오고")).toContain("<em>People&#x27;s Instinctive Travels</em>이");
    expect(html("**중요** 내용")).toContain("<strong>중요</strong> 내용");
    expect(html("### *Loaded* 녹음")).toContain("<h3><em>Loaded</em> 녹음</h3>");
  });
  it("강조가 아닌 별표·밑줄은 그대로", () => {
    expect(html("2 * 3 * 4")).toContain("2 * 3 * 4");
    expect(html("snake_case_name")).toContain("snake_case_name");
  });
  it("배지 앞으로 옮겨진 문장부호와 함께 써도 기울임 유지", () => {
    expect(html("*OK Computer*를 녹음했다 [Wikipedia].")).toContain("<em>OK Computer</em>를 녹음했다. <span");
  });
});
