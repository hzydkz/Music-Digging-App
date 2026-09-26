import { describe, expect, it } from "vitest";
import * as mb from "@/sources/musicbrainz";
import { fixture } from "./helpers";

describe("musicbrainz parsers", () => {
  it("검색 결과를 후보로 변환", () => {
    const r = mb.parseSearch(fixture("mb-search.json"));
    expect(r[0]).toEqual({
      mbid: "b1392450-e666-3926-a536-22c65f834433",
      title: "OK Computer",
      artist: "Radiohead",
      year: 1997,
      type: "Album",
      score: 100,
    });
    expect(r[1].artist).toBe("Radiohead & Guest");
    expect(r[1].type).toBe("Album + Compilation");
  });

  it("release-group: url-rel, 장르 정렬, 대표 release 선택", () => {
    const rg = mb.parseReleaseGroup(fixture("mb-release-group.json"));
    expect(rg.year).toBe(1997);
    expect(rg.genres).toEqual(["alternative rock", "art rock"]);
    expect(rg.urlRels.map((u) => u.type)).toEqual(["wikidata", "discogs", "allmusic"]);
    // 부틀렉 제외, 공식 발매 중 가장 이른 날짜
    expect(rg.representativeReleaseMbid).toBe("rel-jp");
    expect(rg.primaryArtist?.id).toBe("a74b1b7f-71a5-4011-9441-d0b5e4122711");
  });

  it("release: 멀티 디스크 트랙 번호, 레이블 중복 제거, 아티스트 관계", () => {
    const rel = mb.parseRelease(fixture("mb-release.json"));
    expect(rel.label).toBe("Parlophone, Capitol");
    expect(rel.tracks.map((t) => t.position)).toEqual(["1-1", "1-2", "2-1"]);
    expect(rel.tracks[2].lengthMs).toBeNull();
    expect(rel.artistCredits).toEqual([{ mbid: "p-1", name: "Nigel Godrich", role: "producer" }]);
    expect(rel.urlRels).toHaveLength(1);
  });

  it("검색 쿼리: '아티스트 - 앨범' 분리, 특수문자 이스케이프", () => {
    expect(mb.buildSearchQuery("OK Computer")).toBe("OK Computer");
    expect(mb.buildSearchQuery("Radiohead - OK Computer")).toBe("releasegroup:(OK Computer) AND artist:(Radiohead)");
    expect(mb.buildSearchQuery("AC/DC - Back in Black")).toBe("releasegroup:(Back in Black) AND artist:(AC\\/DC)");
    expect(mb.buildSearchQuery("Sgt. Pepper's (Remaster)")).toBe("Sgt. Pepper's \\(Remaster\\)");
    expect(mb.buildSearchQuery("A-ha")).toBe("A\\-ha");
  });
});
