/**
 * 영문 Wikipedia (MediaWiki Action API) + Wikidata sitelink.
 * 연결 순서: MusicBrainz url-rel(wikipedia) → url-rel(wikidata → enwiki sitelink) → 제목 검색.
 * 검색으로 찾은 경우엔 자동 확정 조건을 엄격하게 두고, 애매하면 후보를 돌려준다.
 */
import type { DB } from "@/db/client";
import { fetchJson } from "@/lib/http";
import { acquireSlot } from "@/lib/rate-limit";
import type { UrlRel } from "./musicbrainz";

const API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export interface WikiCandidate {
  title: string;
  snippet: string;
}

export type WikiResolution =
  | { kind: "title"; title: string; via: "musicbrainz" | "wikidata" | "search" }
  | { kind: "candidates"; candidates: WikiCandidate[] }
  | { kind: "none" };

export function titleFromWikipediaUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

export function wikidataIdFromUrl(url: string): string | null {
  const m = url.match(/wikidata\.org\/wiki\/(Q\d+)/);
  return m ? m[1] : null;
}

export interface WikidataSitelinksResponse {
  entities: Record<string, { sitelinks?: Record<string, { title: string }> }>;
}
export function parseWikidataEnwiki(res: WikidataSitelinksResponse, qid: string): string | null {
  return res.entities[qid]?.sitelinks?.enwiki?.title ?? null;
}

export interface WikiSearchResponse {
  query?: { search: Array<{ title: string; snippet: string }> };
}
export function parseSearch(res: WikiSearchResponse): WikiCandidate[] {
  return (res.query?.search ?? []).map((s) => ({
    title: s.title,
    snippet: s.snippet.replace(/<[^>]+>/g, ""),
  }));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .trim();
}

/**
 * 검색 결과에서 자동 확정할 문서를 고른다.
 * "{앨범명} ({아티스트} album)" 이 정확히 있거나, "{앨범명}" / "{앨범명} (album)" 이 유일할 때만 확정.
 * 그 외는 null (→ 사용자 선택).
 */
export function pickSearchMatch(
  candidates: WikiCandidate[],
  albumTitle: string,
  artist: string,
): string | null {
  const a = norm(albumTitle);
  const exactWithArtist = candidates.find(
    (c) => norm(c.title) === `${a} (${norm(artist)} album)`,
  );
  if (exactWithArtist) return exactWithArtist.title;
  const plain = candidates.filter((c) => {
    const t = norm(c.title);
    return t === a || t === `${a} (album)`;
  });
  return plain.length === 1 ? plain[0].title : null;
}

export interface WikiExtractResponse {
  query?: {
    pages: Array<{ title: string; missing?: boolean; extract?: string; pageid?: number }>;
  };
}

const DROP_SECTIONS = new Set([
  "references",
  "external links",
  "see also",
  "notes",
  "further reading",
  "sources",
  "bibliography",
  "citations",
  "charts",
  "weekly charts",
  "year-end charts",
  "certifications",
  "certifications and sales",
  "track listing",
  "release history",
]);

/**
 * explaintext 추출본을 섹션 단위로 나누고, 서술과 무관한 섹션(참고문헌·차트 등)을 뺀다.
 * 크레딧은 Discogs/MusicBrainz 구조 데이터로 따로 다루지만, Personnel 섹션은 대조용으로 남긴다.
 */
export function cleanExtract(extract: string): string {
  const lines = extract.split("\n");
  const out: string[] = [];
  let dropLevel: number | null = null;
  for (const line of lines) {
    const h = line.match(/^(={2,6})\s*(.+?)\s*\1$/);
    if (h) {
      const level = h[1].length;
      if (dropLevel !== null && level > dropLevel) continue;
      dropLevel = DROP_SECTIONS.has(h[2].toLowerCase()) ? level : null;
      if (dropLevel === null) out.push(line);
      continue;
    }
    if (dropLevel === null) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 문서 도입부에 아티스트 이름이 나오는지 (검색으로 찾은 문서의 오매칭 방지) */
export function leadMentions(extract: string, artist: string): boolean {
  const lead = norm(extract.slice(0, 1500));
  return lead.includes(norm(artist));
}

export function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function wikiGet<T>(db: DB, base: string, params: Record<string, string>): Promise<T> {
  await acquireSlot(db, "wikipedia", 200);
  const qs = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  return fetchJson<T>(`${base}?${qs}`);
}

export async function resolveTitle(
  db: DB,
  rels: UrlRel[],
  albumTitle: string,
  artist: string,
): Promise<WikiResolution> {
  for (const r of rels) {
    if (r.type === "wikipedia") {
      const t = titleFromWikipediaUrl(r.url);
      if (t) return { kind: "title", title: t, via: "musicbrainz" };
    }
  }
  for (const r of rels) {
    if (r.type !== "wikidata") continue;
    const qid = wikidataIdFromUrl(r.url);
    if (!qid) continue;
    const res = await wikiGet<WikidataSitelinksResponse>(db, WIKIDATA_API, {
      action: "wbgetentities",
      ids: qid,
      props: "sitelinks",
      sitefilter: "enwiki",
    });
    const t = parseWikidataEnwiki(res, qid);
    if (t) return { kind: "title", title: t, via: "wikidata" };
  }
  const res = await wikiGet<WikiSearchResponse>(db, API, {
    action: "query",
    list: "search",
    srsearch: `${albumTitle} ${artist} album`,
    srlimit: "6",
  });
  const candidates = parseSearch(res);
  if (!candidates.length) return { kind: "none" };
  const picked = pickSearchMatch(candidates, albumTitle, artist);
  if (picked) return { kind: "title", title: picked, via: "search" };
  return { kind: "candidates", candidates };
}

export async function fetchExtract(
  db: DB,
  title: string,
): Promise<{ title: string; text: string } | null> {
  const res = await wikiGet<WikiExtractResponse>(db, API, {
    action: "query",
    prop: "extracts",
    explaintext: "1",
    redirects: "1",
    titles: title,
  });
  const page = res.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;
  return { title: page.title, text: cleanExtract(page.extract) };
}
