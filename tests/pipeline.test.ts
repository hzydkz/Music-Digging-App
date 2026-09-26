import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { credits, jobs, notes, releases, sourceRaw, usage } from "@/db/schema";
import type { DB } from "@/db/client";
import * as pipeline from "@/lib/pipeline";
import { listLibrary, notedIds } from "@/lib/queries";
import { acquireSlot } from "@/lib/rate-limit";
import { fixture, testDb } from "./helpers";

const generateAlbumNote = vi.fn();
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  generateAlbumNote: (...args: unknown[]) => generateAlbumNote(...args),
}));

const RG = "b1392450-e666-3926-a536-22c65f834433";

type Routes = Array<[RegExp, unknown | ((url: string) => Response)]>;

function stubFetch(routes: Routes) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) return new Response(`no route for ${url}`, { status: 404 });
      const body = hit[1];
      if (typeof body === "function") return (body as (u: string) => Response)(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

async function runAll(db: DB, id: string, max = 10) {
  const ran: string[] = [];
  for (let i = 0; i < max; i++) {
    const { ran: job } = await pipeline.runNextJob(db, id);
    if (!job) break;
    ran.push(`${job.type}:${job.target}`);
  }
  return ran;
}

function llmOk() {
  generateAlbumNote.mockResolvedValue({
    output: { summary: "라디오헤드의 세 번째 앨범 [Wikipedia]", background: "### 녹음\n세인트 캐서린스 코트에서 녹음 [Wikipedia]" },
    model: "claude-opus-5",
    usage: { input_tokens: 1000, output_tokens: 200 },
    cost: 0.01,
  });
}

let ctx: Awaited<ReturnType<typeof testDb>>;

beforeEach(async () => {
  ctx = await testDb();
  process.env.DISCOGS_TOKEN = "test-token";
  delete process.env.MONTHLY_BUDGET_USD;
  generateAlbumNote.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  ctx.cleanup();
});

describe("pickRunnable", () => {
  const job = (id: number, type: "fetch" | "summarize", target: string, status: string) =>
    ({ id, type, target, status }) as pipeline.Job;

  it("fetch를 먼저, summarize는 fetch가 모두 끝난 뒤", () => {
    expect(pipeline.pickRunnable([job(1, "fetch", "wikipedia", "pending"), job(3, "summarize", "album", "pending")])?.id).toBe(1);
    expect(pipeline.pickRunnable([job(1, "fetch", "wikipedia", "running"), job(3, "summarize", "album", "pending")])).toBeNull();
    expect(pipeline.pickRunnable([job(1, "fetch", "wikipedia", "waiting"), job(3, "summarize", "album", "pending")])).toBeNull();
    expect(pipeline.pickRunnable([job(1, "fetch", "wikipedia", "failed"), job(2, "fetch", "discogs", "done"), job(3, "summarize", "album", "pending")])?.id).toBe(3);
  });
});

describe("pipeline", () => {
  it("선택 → 노트 만들기 → job 순서대로 실행 → 저장", { timeout: 20_000 }, async () => {
    const calls = stubFetch([
      [/musicbrainz\.org\/ws\/2\/release-group\//, fixture("mb-release-group.json")],
      [/musicbrainz\.org\/ws\/2\/release\//, fixture("mb-release.json")],
      [/wikidata\.org/, fixture("wikidata-sitelinks.json")],
      [/en\.wikipedia\.org.*prop=extracts/, fixture("wiki-extract.json")],
      [/api\.discogs\.com\/releases\/1234567/, fixture("discogs-release.json")],
    ]);
    llmOk();
    const { db } = ctx;

    const id = await pipeline.importReleaseGroup(db, RG);
    expect(id).toBe(RG);
    // 메타데이터만 가져올 땐 LLM을 부르지 않는다
    expect(generateAlbumNote).not.toHaveBeenCalled();
    const rel = await db.query.releases.findFirst({ where: eq(releases.id, RG) });
    expect(rel?.releaseMbid).toBe("rel-jp");
    expect(rel?.noteStatus).toBe("none");

    // 같은 MBID를 다시 선택해도 외부 호출 없음
    const before = calls.length;
    await pipeline.importReleaseGroup(db, RG);
    expect(calls.length).toBe(before);

    // 열어 보기만 한 앨범은 라이브러리에 없다
    expect(await listLibrary(db)).toHaveLength(0);

    expect(await pipeline.startNote(db, RG)).toEqual({ ok: true });
    expect((await listLibrary(db)).map((r) => r.id)).toEqual([RG]);
    expect(await notedIds(db, [RG])).toEqual(new Set());
    expect(await runAll(db, RG)).toEqual(["fetch:wikipedia", "fetch:discogs", "summarize:album"]);
    expect(await notedIds(db, [RG])).toEqual(new Set([RG]));

    // Discogs는 release url-rel(1234567)을 master보다 우선 사용
    expect(calls.some((u) => u.includes("/masters/"))).toBe(false);
    expect(calls.find((u) => u.includes("api.discogs.com"))).toContain("/releases/1234567");

    const [, docs] = generateAlbumNote.mock.calls[0];
    expect((docs as Array<{ label: string }>).map((d) => d.label).sort()).toEqual(["Discogs", "MusicBrainz", "Wikipedia"]);

    const saved = await db.query.notes.findMany({ where: eq(notes.entityId, RG) });
    expect(saved.map((n) => n.section).sort()).toEqual(["background", "summary"]);
    expect((await db.query.releases.findFirst({ where: eq(releases.id, RG) }))?.noteStatus).toBe("ready");

    const discogsCredits = await db.select().from(credits).where(and(eq(credits.releaseId, RG), eq(credits.source, "discogs")));
    expect(discogsCredits).toHaveLength(3);

    const [u] = await db.select().from(usage);
    expect(u.inputTokens).toBe(1000);
    expect(u.estCost).toBeCloseTo(0.01);

    // 다시 생성: 저장된 원문을 재사용하고 summarize만 다시 실행
    const fetchCount = calls.length;
    await pipeline.startNote(db, RG);
    expect(await runAll(db, RG)).toEqual(["summarize:album"]);
    expect(calls.length).toBe(fetchCount);
    const [u2] = await db.select().from(usage);
    expect(u2.inputTokens).toBe(2000);
  });

  it("매칭이 애매하면 멈추고 사용자 선택을 기다린다", { timeout: 20_000 }, async () => {
    const rg = { ...fixture<Record<string, unknown>>("mb-release-group.json"), relations: [] };
    const release = { ...fixture<Record<string, unknown>>("mb-release.json"), relations: [] };
    stubFetch([
      [/musicbrainz\.org\/ws\/2\/release-group\//, rg],
      [/musicbrainz\.org\/ws\/2\/release\//, release],
      [/en\.wikipedia\.org.*list=search/, fixture("wiki-search.json")],
      [/en\.wikipedia\.org.*prop=extracts/, fixture("wiki-extract.json")],
      [/api\.discogs\.com\/database\/search/, fixture("discogs-search.json")],
    ]);
    llmOk();
    const { db } = ctx;
    await pipeline.importReleaseGroup(db, RG);
    await pipeline.startNote(db, RG);

    expect(await runAll(db, RG)).toEqual(["fetch:wikipedia", "fetch:discogs"]);
    const waiting = await db.select().from(jobs).where(eq(jobs.status, "waiting"));
    expect(waiting.map((j) => j.target).sort()).toEqual(["discogs", "wikipedia"]);
    const raws = await db.select().from(sourceRaw).where(eq(sourceRaw.status, "needs_choice"));
    expect(raws).toHaveLength(2);
    expect(generateAlbumNote).not.toHaveBeenCalled();

    await pipeline.chooseCandidate(db, RG, "wikipedia", "OK Computer");
    await pipeline.chooseCandidate(db, RG, "discogs", null);
    expect(await runAll(db, RG)).toEqual(["fetch:wikipedia", "fetch:discogs", "summarize:album"]);

    const wikiRaw = await db.query.sourceRaw.findFirst({ where: eq(sourceRaw.source, "wikipedia") });
    expect(wikiRaw?.status).toBe("ok");
    const discogsRaw = await db.query.sourceRaw.findFirst({ where: eq(sourceRaw.source, "discogs") });
    expect(discogsRaw?.status).toBe("not_found");
    expect(generateAlbumNote).toHaveBeenCalledTimes(1);
  });

  it("소스가 모두 실패해도 나머지는 진행하고, 서술 자료가 없으면 LLM을 부르지 않는다", { timeout: 20_000 }, async () => {
    stubFetch([
      [/musicbrainz\.org\/ws\/2\/release-group\//, fixture("mb-release-group.json")],
      [/musicbrainz\.org\/ws\/2\/release\//, fixture("mb-release.json")],
      [/wikidata\.org/, () => new Response("boom", { status: 503 })],
      [/api\.discogs\.com/, () => new Response("rate limited", { status: 429 })],
    ]);
    const { db } = ctx;
    await pipeline.importReleaseGroup(db, RG);
    await pipeline.startNote(db, RG);
    expect(await runAll(db, RG)).toEqual(["fetch:wikipedia", "fetch:discogs", "summarize:album"]);

    const all = await pipeline.listJobs(db, RG);
    expect(all.map((j) => j.status)).toEqual(["failed", "failed", "done"]);
    expect(all[1].error).toContain("429");
    expect(generateAlbumNote).not.toHaveBeenCalled();
    const bg = await db.query.notes.findFirst({ where: eq(notes.section, "background") });
    expect(bg?.contentKo).toBe(pipeline.NO_DATA);

    // 다시 시도하면 해당 fetch만 pending
    await pipeline.retrySource(db, RG, "discogs");
    const after = await pipeline.listJobs(db, RG);
    expect(after.find((j) => j.target === "discogs")?.status).toBe("pending");
    expect(await db.query.sourceRaw.findFirst({ where: eq(sourceRaw.source, "discogs") })).toBeUndefined();
  });

  it("수동 모드: 수집만 하고 LLM을 부르지 않으며, 붙여넣은 답변을 저장", { timeout: 20_000 }, async () => {
    stubFetch([
      [/musicbrainz\.org\/ws\/2\/release-group\//, fixture("mb-release-group.json")],
      [/musicbrainz\.org\/ws\/2\/release\//, fixture("mb-release.json")],
      [/wikidata\.org/, fixture("wikidata-sitelinks.json")],
      [/en\.wikipedia\.org.*prop=extracts/, fixture("wiki-extract.json")],
      [/api\.discogs\.com\/releases\/1234567/, fixture("discogs-release.json")],
    ]);
    const { db } = ctx;
    process.env.MONTHLY_BUDGET_USD = "0.01";
    await pipeline.recordUsage(db, 1, 1, 5); // 예산 초과 상태여도 수동 모드는 막지 않는다
    await pipeline.importReleaseGroup(db, RG);

    expect(await pipeline.getManualPrompt(db, RG)).toBeNull(); // 서술 자료 수집 전
    expect(await pipeline.startNote(db, RG, { mode: "manual" })).toEqual({ ok: true });
    // 수동 모드로 자료를 모으기 시작하면 노트가 없어도 라이브러리에 보인다
    expect(await listLibrary(db)).toHaveLength(1);
    expect(await runAll(db, RG)).toEqual(["fetch:wikipedia", "fetch:discogs"]);
    expect(generateAlbumNote).not.toHaveBeenCalled();
    expect((await db.query.releases.findFirst({ where: eq(releases.id, RG) }))?.noteStatus).toBe("none");

    const prompt = await pipeline.getManualPrompt(db, RG);
    expect(prompt).toContain('<source name="Wikipedia"');
    expect(prompt).toContain('<source name="Discogs"');

    await expect(pipeline.saveManualNote(db, RG, "형식 없는 글")).rejects.toThrow();
    await pipeline.saveManualNote(db, RG, "## 한 줄 요약\n요약 [Wikipedia]\n\n## 제작 배경\n배경 [Discogs]");
    const bg = await db.query.notes.findFirst({ where: eq(notes.section, "background") });
    expect(bg?.contentKo).toBe("배경 [Discogs]");
    expect(bg?.model).toBe(pipeline.MANUAL_MODEL_LABEL);
    expect(JSON.parse(bg!.sourcesJson).map((s: { label: string }) => s.label).sort()).toEqual(["Discogs", "MusicBrainz", "Wikipedia"]);
    expect((await db.query.releases.findFirst({ where: eq(releases.id, RG) }))?.noteStatus).toBe("ready");

    // 이후 자동 생성으로 전환하면 summarize job만 추가된다 (저장된 원문 재사용)
    process.env.MONTHLY_BUDGET_USD = "";
    llmOk();
    await pipeline.startNote(db, RG, { mode: "auto" });
    expect(await runAll(db, RG)).toEqual(["summarize:album"]);
  });

  it("월 예산을 넘으면 생성 전에 멈추고, force면 진행", async () => {
    const { db } = ctx;
    process.env.MONTHLY_BUDGET_USD = "1";
    await pipeline.recordUsage(db, 10, 10, 0.6);
    await pipeline.recordUsage(db, 10, 10, 0.5);
    expect(await pipeline.monthSpend(db)).toBeCloseTo(1.1);
    const r = await pipeline.startNote(db, RG);
    expect(r).toMatchObject({ ok: false, reason: "budget", budget: 1 });
    expect(await pipeline.listJobs(db, RG)).toHaveLength(0);
    expect(await pipeline.startNote(db, RG, { force: true })).toEqual({ ok: true });
  });
});

describe("acquireSlot", () => {
  it("동시에 요청해도 간격을 지킨다", async () => {
    const { db } = ctx;
    const done: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      [0, 1, 2].map(() => acquireSlot(db, "test", 250).then(() => done.push(Date.now() - t0))),
    );
    done.sort((a, b) => a - b);
    expect(done[1] - done[0]).toBeGreaterThanOrEqual(240);
    expect(done[2] - done[1]).toBeGreaterThanOrEqual(240);
  });

  it("최대 대기를 넘으면 에러", async () => {
    const { db } = ctx;
    await acquireSlot(db, "slow", 10_000);
    await expect(acquireSlot(db, "slow", 10_000, { maxWaitMs: 100 })).rejects.toThrow("대기 시간");
  });
});
