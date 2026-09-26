import { describe, expect, it } from "vitest";
import * as discogs from "@/sources/discogs";
import { fixture } from "./helpers";

describe("discogs", () => {
  it("URL 해석", () => {
    expect(discogs.refFromUrl("https://www.discogs.com/master/21491")).toEqual({ kind: "master", id: 21491 });
    expect(discogs.refFromUrl("https://www.discogs.com/release/1234567-Radiohead-OK-Computer")).toEqual({ kind: "release", id: 1234567 });
    expect(discogs.refFromUrl("https://www.discogs.com/ko/release/42")).toEqual({ kind: "release", id: 42 });
    expect(discogs.refFromUrl("https://www.discogs.com/artist/3840")).toBeNull();
  });

  it("release 링크를 master보다 우선", () => {
    const ref = discogs.pickRef(
      [{ type: "discogs", url: "https://www.discogs.com/release/5" }],
      [{ type: "discogs", url: "https://www.discogs.com/master/7" }],
    );
    expect(ref).toEqual({ kind: "release", id: 5 });
    expect(discogs.pickRef([], [{ type: "discogs", url: "https://www.discogs.com/master/7" }])).toEqual({ kind: "master", id: 7 });
    expect(discogs.pickRef([], [])).toBeNull();
  });

  it("크레딧: 앨범 전체 + 트랙별, 동명이인 표기 제거", () => {
    const credits = discogs.parseCredits(fixture("discogs-release.json"));
    expect(credits).toEqual([
      { discogsId: 100, name: "Nigel Godrich", role: "Producer", tracks: null },
      { discogsId: 101, name: "Stanley Donwood", role: "Artwork", tracks: null },
      { discogsId: 102, name: "Jonny Greenwood", role: "Organ", tracks: "2" },
    ]);
  });

  it("LLM 입력 텍스트에 노트와 크레딧 포함", () => {
    const text = discogs.releaseToText(fixture("discogs-release.json"));
    expect(text).toContain("Labels: Parlophone (NODATA 02)");
    expect(text).toContain("- Organ: Jonny Greenwood [tracks 2]");
    expect(text).toContain("Recorded at Canned Applause");
  });

  it("검색: 표기가 같은 master가 둘이면 자동 확정 안 함", () => {
    const c = discogs.parseSearch(fixture("discogs-search.json"));
    expect(c.map((x) => x.masterId)).toEqual([21491, 99999]);
    expect(discogs.pickSearchMatch(c, "OK Computer", "Radiohead")).toBeNull();
    expect(discogs.pickSearchMatch(c.slice(0, 1), "OK Computer", "Radiohead")).toBe(21491);
    expect(discogs.pickSearchMatch(c.slice(0, 1), "Kid A", "Radiohead")).toBeNull();
  });
});
