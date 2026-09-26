import { describe, expect, it } from "vitest";
import * as wiki from "@/sources/wikipedia";
import { fixture } from "./helpers";

describe("wikipedia", () => {
  it("URL에서 제목/QID 추출", () => {
    expect(wiki.titleFromWikipediaUrl("https://en.wikipedia.org/wiki/Kid_A")).toBe("Kid A");
    expect(wiki.titleFromWikipediaUrl("https://en.wikipedia.org/wiki/Sigur_R%C3%B3s")).toBe("Sigur Rós");
    expect(wiki.titleFromWikipediaUrl("https://fr.wikipedia.org/wiki/Kid_A")).toBeNull();
    expect(wiki.wikidataIdFromUrl("https://www.wikidata.org/wiki/Q213434")).toBe("Q213434");
  });

  it("wikidata sitelink", () => {
    expect(wiki.parseWikidataEnwiki(fixture("wikidata-sitelinks.json"), "Q213434")).toBe("OK Computer");
    expect(wiki.parseWikidataEnwiki(fixture("wikidata-sitelinks.json"), "Q1")).toBeNull();
  });

  it("검색 매칭: 동명 앨범이 여럿이면 아티스트가 맞는 것만 확정", () => {
    const c = wiki.parseSearch(fixture("wiki-search.json"));
    expect(c[0].snippet).toBe("Blue is the fourth studio album");
    expect(wiki.pickSearchMatch(c, "Blue", "Joni Mitchell")).toBe("Blue (Joni Mitchell album)");
    // 아티스트 표기가 다르면 자동 확정하지 않는다
    expect(wiki.pickSearchMatch(c, "Blue", "The Joni Mitchell Band")).toBeNull();
  });

  it("검색 매칭: 괄호 없는 제목이 유일할 때만 확정", () => {
    const one = [{ title: "OK Computer", snippet: "" }, { title: "Kid A", snippet: "" }];
    expect(wiki.pickSearchMatch(one, "OK Computer", "Radiohead")).toBe("OK Computer");
    const two = [{ title: "Low", snippet: "" }, { title: "Low (album)", snippet: "" }];
    expect(wiki.pickSearchMatch(two, "Low", "David Bowie")).toBeNull();
  });

  it("추출본 정리: 트랙 목록·참고문헌과 그 하위 섹션 제거, Personnel은 유지", () => {
    const res = fixture<wiki.WikiExtractResponse>("wiki-extract.json");
    const text = wiki.cleanExtract(res.query!.pages[0].extract!);
    expect(text).toContain("== Background ==");
    expect(text).toContain("=== Recording ===");
    expect(text).toContain("== Personnel ==");
    expect(text).not.toContain("Track listing");
    expect(text).not.toContain("sub note under track listing");
    expect(text).not.toContain("Ref 1");
  });

  it("도입부 아티스트 언급 확인", () => {
    expect(wiki.leadMentions("OK Computer is the third album by Radiohead.", "radiohead")).toBe(true);
    expect(wiki.leadMentions("Blue is a colour.", "Joni Mitchell")).toBe(false);
  });
});
