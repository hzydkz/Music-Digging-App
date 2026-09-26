import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { notedIds } from "@/lib/queries";
import { searchReleaseGroups } from "@/sources/musicbrainz";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return jsonError("검색어를 입력하세요.", 400);
  return handle(async () => {
    const db = getDb();
    const results = await searchReleaseGroups(db, q);
    const saved = await notedIds(db, results.map((r) => r.mbid));
    return { results: results.map((r) => ({ ...r, saved: saved.has(r.mbid) })) };
  });
}
