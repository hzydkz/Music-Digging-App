/**
 * Discogs API (개인 토큰 인증).
 * 연결 순서: MusicBrainz url-rel(release의 discogs release → release-group의 discogs master) → 검색.
 * 인증 시 분당 60회 제한 → 호출 간격 1초.
 * 문서: https://www.discogs.com/developers
 */
import type { DB } from "@/db/client";
import { fetchJson } from "@/lib/http";
import { acquireSlot } from "@/lib/rate-limit";
import type { UrlRel } from "./musicbrainz";

const BASE = "https://api.discogs.com";

interface DiscogsArtistRef {
  id: number;
  name: string;
  anv?: string;
  role?: string;
  tracks?: string;
}
export interface DiscogsReleaseResponse {
  id: number;
  title: string;
  year?: number;
  uri?: string;
  artists?: DiscogsArtistRef[];
  labels?: Array<{ name: string; catno?: string }>;
  extraartists?: DiscogsArtistRef[];
  tracklist?: Array<{
    position: string;
    title: string;
    type_?: string;
    extraartists?: DiscogsArtistRef[];
  }>;
  notes?: string;
  genres?: string[];
  styles?: string[];
}
export interface DiscogsMasterResponse {
  id: number;
  main_release: number;
  title: string;
}
export interface DiscogsSearchResponse {
  results: Array<{
    id: number;
    type: string;
    title: string;
    year?: string;
    master_id?: number;
    uri?: string;
  }>;
}

export interface DiscogsCredit {
  discogsId: number;
  name: string;
  role: string;
  tracks: string | null;
}
export interface DiscogsCandidate {
  masterId: number;
  title: string;
  year: string | null;
}

export type DiscogsRef = { kind: "release"; id: number } | { kind: "master"; id: number };

export function refFromUrl(url: string): DiscogsRef | null {
  const m = url.match(/discogs\.com\/(?:[a-z-]+\/)?(master|release)\/(\d+)/);
  if (!m) return null;
  return { kind: m[1] as "master" | "release", id: Number(m[2]) };
}

/** release 쪽 링크(특정 판본)를 master보다 우선한다. */
export function pickRef(releaseRels: UrlRel[], groupRels: UrlRel[]): DiscogsRef | null {
  const refs = [...releaseRels, ...groupRels]
    .filter((r) => r.type === "discogs")
    .map((r) => refFromUrl(r.url))
    .filter((r): r is DiscogsRef => r !== null);
  return refs.find((r) => r.kind === "release") ?? refs.find((r) => r.kind === "master") ?? null;
}

/** Discogs 동명이인 표기 "(2)" 제거 */
export function cleanName(name: string): string {
  return name.replace(/\s\(\d+\)$/, "").trim();
}

export function parseCredits(res: DiscogsReleaseResponse): DiscogsCredit[] {
  const out: DiscogsCredit[] = [];
  for (const a of res.extraartists ?? []) {
    if (!a.role) continue;
    out.push({
      discogsId: a.id,
      name: cleanName(a.name),
      role: a.role,
      tracks: a.tracks?.trim() || null,
    });
  }
  for (const t of res.tracklist ?? []) {
    for (const a of t.extraartists ?? []) {
      if (!a.role) continue;
      out.push({ discogsId: a.id, name: cleanName(a.name), role: a.role, tracks: t.position || null });
    }
  }
  return out;
}

/** LLM 입력용 텍스트: 레이블·장르·노트. 크레딧은 구조 데이터로 따로 보여주므로 요약만. */
export function releaseToText(res: DiscogsReleaseResponse): string {
  const lines: string[] = [];
  lines.push(`Title: ${res.title}`);
  if (res.year) lines.push(`Year: ${res.year}`);
  if (res.labels?.length)
    lines.push(`Labels: ${res.labels.map((l) => `${l.name}${l.catno ? ` (${l.catno})` : ""}`).join("; ")}`);
  if (res.genres?.length) lines.push(`Genres: ${res.genres.join(", ")}`);
  if (res.styles?.length) lines.push(`Styles: ${res.styles.join(", ")}`);
  const credits = parseCredits(res);
  if (credits.length) {
    lines.push("Credits:");
    for (const c of credits) lines.push(`- ${c.role}: ${c.name}${c.tracks ? ` [tracks ${c.tracks}]` : ""}`);
  }
  if (res.notes?.trim()) lines.push("", "Release notes:", res.notes.trim());
  return lines.join("\n");
}

export function parseSearch(res: DiscogsSearchResponse): DiscogsCandidate[] {
  return res.results
    .filter((r) => r.type === "master")
    .map((r) => ({ masterId: r.id, title: r.title, year: r.year ?? null }));
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Discogs 검색 제목은 "Artist - Title" 형식. 정확히 일치하는 게 하나일 때만 자동 확정. */
export function pickSearchMatch(
  candidates: DiscogsCandidate[],
  albumTitle: string,
  artist: string,
): number | null {
  const want = norm(`${artist} - ${albumTitle}`);
  const hits = candidates.filter((c) => {
    const sep = c.title.indexOf(" - ");
    if (sep < 0) return false;
    const title = `${cleanName(c.title.slice(0, sep))} - ${c.title.slice(sep + 3)}`;
    return norm(title) === want;
  });
  return hits.length === 1 ? hits[0].masterId : null;
}

export function releasePageUrl(id: number) {
  return `https://www.discogs.com/release/${id}`;
}

function token(): string {
  const t = process.env.DISCOGS_TOKEN;
  if (!t) throw new Error("DISCOGS_TOKEN 환경변수가 설정되지 않았습니다.");
  return t;
}

async function discogsGet<T>(db: DB, path: string): Promise<T> {
  await acquireSlot(db, "discogs", 1000);
  return fetchJson<T>(`${BASE}${path}`, {
    headers: { Authorization: `Discogs token=${token()}` },
  });
}

export async function getRelease(db: DB, id: number): Promise<DiscogsReleaseResponse> {
  return discogsGet(db, `/releases/${id}`);
}

export async function getMasterMainRelease(db: DB, masterId: number): Promise<number> {
  const m = await discogsGet<DiscogsMasterResponse>(db, `/masters/${masterId}`);
  return m.main_release;
}

export async function search(
  db: DB,
  albumTitle: string,
  artist: string,
): Promise<DiscogsCandidate[]> {
  const qs = new URLSearchParams({
    type: "master",
    artist,
    release_title: albumTitle,
    per_page: "8",
  });
  const res = await discogsGet<DiscogsSearchResponse>(db, `/database/search?${qs}`);
  return parseSearch(res);
}
