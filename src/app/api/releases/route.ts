import { getDb } from "@/db/client";
import { handle, jsonError } from "@/lib/api";
import { importReleaseGroup } from "@/lib/pipeline";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 검색 후보 선택: MusicBrainz 메타데이터와 커버만 저장한다 (LLM 호출 없음). */
export async function POST(req: Request) {
  const { mbid } = (await req.json().catch(() => ({}))) as { mbid?: string };
  if (!mbid || !MBID.test(mbid)) return jsonError("잘못된 MBID입니다.", 400);
  return handle(async () => ({ id: await importReleaseGroup(getDb(), mbid) }));
}
