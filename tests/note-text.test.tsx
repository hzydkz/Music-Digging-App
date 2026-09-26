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
