/**
 * MusicBrainz 웹서비스 v2.
 * - 초당 1회 제한: 모든 호출은 acquireSlot("musicbrainz", 1100)을 거친다.
 * - User-Agent 필수 (lib/http.ts).
 * 문서: https://musicbrainz.org/doc/MusicBrainz_API
 */
import type { DB } from "@/db/client";
import { fetchJson } from "@/lib/http";
import { acquireSlot } from "@/lib/rate-limit";

const BASE = "https://musicbrainz.org/ws/2";
export const MB_INTERVAL_MS = 1100;

// ---- API 응답 타입 (사용하는 필드만) ----
interface MbArtistCredit {
  name: string;
  joinphrase?: string;
  artist: { id: string; name: string; "sort-name"?: string };
}
interface MbRelation {
  type: string;
  "target-type"?: string;
  url?: { resource: string };
  artist?: { id: string; name: string };
  attributes?: string[];
}
export interface MbReleaseGroupSearchResponse {
  "release-groups": Array<{
    id: string;
    title: string;
    score?: number;
    "primary-type"?: string;
    "secondary-types"?: string[];
    "first-release-date"?: string;
    "artist-credit"?: MbArtistCredit[];
  }>;
}
export interface MbReleaseGroupResponse {
  id: string;
  title: string;
  "primary-type"?: string;
  "first-release-date"?: string;
  "artist-credit"?: MbArtistCredit[];
  relations?: MbRelation[];
  genres?: Array<{ name: string; count: number }>;
  releases?: Array<{ id: string; title: string; status?: string; date?: string; country?: string }>;
}
export interface MbReleaseResponse {
  id: string;
  title: string;
  date?: string;
  "label-info"?: Array<{ label?: { name: string }; "catalog-number"?: string }>;
  media?: Array<{
    position: number;
    tracks?: Array<{ number: string; position: number; title: string; length?: number | null }>;
  }>;
  relations?: MbRelation[];
}

// ---- 정규화된 결과 ----
export interface ReleaseGroupCandidate {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  type: string;
  score: number | null;
}
export interface UrlRel {
  type: string;
  url: string;
}
export interface ReleaseGroupDetail {
  mbid: string;
  title: string;
  artistCredit: string;
  primaryArtist: { id: string; name: string; sortName: string | null } | null;
  year: number | null;
  primaryType: string | null;
  genres: string[];
  urlRels: UrlRel[];
  representativeReleaseMbid: string | null;
}
export interface ReleaseDetail {
  mbid: string;
  label: string | null;
  tracks: Array<{ position: string; title: string; lengthMs: number | null }>;
  urlRels: UrlRel[];
  artistCredits: Array<{ mbid: string; name: string; role: string }>;
}

export function creditToString(credit: MbArtistCredit[] | undefined): string {
  if (!credit?.length) return "Unknown Artist";
  return credit.map((c) => c.name + (c.joinphrase ?? "")).join("").trim();
}

function yearOf(date: string | undefined): number | null {
  const m = date?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

function urlRels(relations: MbRelation[] | undefined): UrlRel[] {
  return (relations ?? [])
    .filter((r) => r.url?.resource)
    .map((r) => ({ type: r.type, url: r.url!.resource }));
}

export function parseSearch(res: MbReleaseGroupSearchResponse): ReleaseGroupCandidate[] {
  return res["release-groups"].map((rg) => ({
    mbid: rg.id,
    title: rg.title,
    artist: creditToString(rg["artist-credit"]),
    year: yearOf(rg["first-release-date"]),
    type: [rg["primary-type"], ...(rg["secondary-types"] ?? [])].filter(Boolean).join(" + ") || "기타",
    score: rg.score ?? null,
  }));
}

/** 대표 release: 공식 발매 중 날짜가 가장 이른 것. 없으면 첫 항목. */
export function pickRepresentativeRelease(
  releases: MbReleaseGroupResponse["releases"],
): string | null {
  if (!releases?.length) return null;
  const official = releases.filter((r) => r.status === "Official");
  const pool = official.length ? official : releases;
  const sorted = [...pool].sort((a, b) => {
    const da = a.date || "9999";
    const db = b.date || "9999";
    return da.localeCompare(db);
  });
  return sorted[0].id;
}

export function parseReleaseGroup(res: MbReleaseGroupResponse): ReleaseGroupDetail {
  const first = res["artist-credit"]?.[0]?.artist;
  return {
    mbid: res.id,
    title: res.title,
    artistCredit: creditToString(res["artist-credit"]),
    primaryArtist: first
      ? { id: first.id, name: first.name, sortName: first["sort-name"] ?? null }
      : null,
    year: yearOf(res["first-release-date"]),
    primaryType: res["primary-type"] ?? null,
    genres: [...(res.genres ?? [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((g) => g.name),
    urlRels: urlRels(res.relations),
    representativeReleaseMbid: pickRepresentativeRelease(res.releases),
  };
}

export function parseRelease(res: MbReleaseResponse): ReleaseDetail {
  const labels = (res["label-info"] ?? [])
    .map((l) => l.label?.name)
    .filter((n): n is string => Boolean(n));
  const multiDisc = (res.media?.length ?? 0) > 1;
  const tracks = (res.media ?? []).flatMap((m) =>
    (m.tracks ?? []).map((t) => ({
      position: multiDisc ? `${m.position}-${t.number}` : t.number,
      title: t.title,
      lengthMs: t.length ?? null,
    })),
  );
  const artistCredits = (res.relations ?? [])
    .filter((r) => r.artist)
    .map((r) => ({
      mbid: r.artist!.id,
      name: r.artist!.name,
      role: [r.type, ...(r.attributes ?? [])].join(", "),
    }));
  return {
    mbid: res.id,
    label: labels.length ? [...new Set(labels)].join(", ") : null,
    tracks,
    urlRels: urlRels(res.relations),
    artistCredits,
  };
}

async function mbGet<T>(db: DB, path: string): Promise<T> {
  await acquireSlot(db, "musicbrainz", MB_INTERVAL_MS);
  const sep = path.includes("?") ? "&" : "?";
  return fetchJson<T>(`${BASE}${path}${sep}fmt=json`);
}

/** Lucene 특수문자 이스케이프 */
export function escapeLucene(s: string): string {
  return s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}

/**
 * 검색어 → Lucene 쿼리.
 * "아티스트 - 앨범" 형식이면 두 필드로 나눠 검색하고, 아니면 제목 검색(기본 필드)으로 둔다.
 */
export function buildSearchQuery(input: string): string {
  const text = input.trim();
  const sep = text.indexOf(" - ");
  if (sep > 0) {
    const artist = text.slice(0, sep).trim();
    const title = text.slice(sep + 3).trim();
    if (artist && title) {
      return `releasegroup:(${escapeLucene(title)}) AND artist:(${escapeLucene(artist)})`;
    }
  }
  return escapeLucene(text);
}

export async function searchReleaseGroups(
  db: DB,
  query: string,
): Promise<ReleaseGroupCandidate[]> {
  const q = encodeURIComponent(buildSearchQuery(query));
  const res = await mbGet<MbReleaseGroupSearchResponse>(
    db,
    `/release-group?query=${q}&limit=15`,
  );
  return parseSearch(res);
}

export async function getReleaseGroup(db: DB, mbid: string): Promise<ReleaseGroupDetail> {
  const res = await mbGet<MbReleaseGroupResponse>(
    db,
    `/release-group/${mbid}?inc=artist-credits+url-rels+genres+releases`,
  );
  return parseReleaseGroup(res);
}

export async function getRelease(db: DB, mbid: string): Promise<ReleaseDetail> {
  const res = await mbGet<MbReleaseResponse>(
    db,
    `/release/${mbid}?inc=labels+recordings+url-rels+artist-rels`,
  );
  return parseRelease(res);
}

export function coverUrlFor(releaseGroupMbid: string): string {
  // Cover Art Archive. 이미지가 없으면 404 → UI에서 기본 아이콘으로 대체.
  return `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-500`;
}

export function mbReleaseGroupUrl(mbid: string): string {
  return `https://musicbrainz.org/release-group/${mbid}`;
}
