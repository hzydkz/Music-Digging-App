/**
 * 앨범 노트 생성 파이프라인.
 *
 * 한 번의 API 호출은 job 하나만 실행한다 (서버리스 시간 제한 대응).
 *   fetch:wikipedia, fetch:discogs  →  summarize:album
 * summarize는 모든 fetch가 끝난(done/failed) 뒤에만 실행된다.
 * 매칭이 애매한 fetch는 status "waiting" + source_raw.status "needs_choice"로 멈추고,
 * 사용자가 후보를 고르거나 건너뛰면 다시 pending이 된다.
 */
import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  artists,
  credits,
  glossary,
  jobs,
  notes,
  persons,
  releases,
  sourceRaw,
  tracks,
  usage,
} from "@/db/schema";
import * as mb from "@/sources/musicbrainz";
import * as wiki from "@/sources/wikipedia";
import * as discogs from "@/sources/discogs";
import { generateAlbumNote, type SourceDoc } from "./llm";

export const ENTITY = "release";
export const FETCH_SOURCES = ["wikipedia", "discogs"] as const;
export type FetchSource = (typeof FETCH_SOURCES)[number];
export const SUMMARY_SECTION = "album";
export const NO_DATA = "수집된 자료 없음";
const STALE_RUNNING_MS = 6 * 60 * 1000;

export type Job = typeof jobs.$inferSelect;

// ---------------------------------------------------------------------------
// 1) 검색 후보 선택 → 메타데이터만 저장 (LLM 비용 없음)
// ---------------------------------------------------------------------------

export async function importReleaseGroup(db: DB, mbid: string): Promise<string> {
  const existing = await db.query.releases.findFirst({ where: eq(releases.id, mbid) });
  if (existing) return existing.id;

  const rg = await mb.getReleaseGroup(db, mbid);
  const rel = rg.representativeReleaseMbid
    ? await mb.getRelease(db, rg.representativeReleaseMbid)
    : null;

  await db.transaction(async (tx) => {
    if (rg.primaryArtist) {
      await tx
        .insert(artists)
        .values({
          id: rg.primaryArtist.id,
          name: rg.primaryArtist.name,
          sortName: rg.primaryArtist.sortName,
        })
        .onConflictDoNothing();
    }
    await tx.insert(releases).values({
      id: rg.mbid,
      releaseMbid: rel?.mbid ?? null,
      title: rg.title,
      artistId: rg.primaryArtist?.id ?? null,
      artistCredit: rg.artistCredit,
      year: rg.year,
      primaryType: rg.primaryType,
      label: rel?.label ?? null,
      coverUrl: mb.coverUrlFor(rg.mbid),
      genresJson: JSON.stringify(rg.genres),
      urlRelsJson: JSON.stringify({ group: rg.urlRels, release: rel?.urlRels ?? [] }),
    });
    if (rel?.tracks.length) {
      await tx.insert(tracks).values(
        rel.tracks.map((t, i) => ({
          releaseId: rg.mbid,
          position: t.position,
          title: t.title,
          lengthMs: t.lengthMs,
          sortOrder: i,
        })),
      );
    }
    for (const c of rel?.artistCredits ?? []) {
      const personId = await upsertPerson(tx as unknown as DB, { mbid: c.mbid, name: c.name });
      await tx.insert(credits).values({
        releaseId: rg.mbid,
        personId,
        role: c.role,
        source: "musicbrainz",
      });
    }
    await tx.insert(sourceRaw).values({
      entityType: ENTITY,
      entityId: rg.mbid,
      source: "musicbrainz",
      url: mb.mbReleaseGroupUrl(rg.mbid),
      status: "ok",
      rawText: musicbrainzText(rg, rel),
    });
  });
  return rg.mbid;
}

function musicbrainzText(rg: mb.ReleaseGroupDetail, rel: mb.ReleaseDetail | null): string {
  const lines = [
    `Title: ${rg.title}`,
    `Artist: ${rg.artistCredit}`,
    rg.year ? `First release year: ${rg.year}` : null,
    rg.primaryType ? `Type: ${rg.primaryType}` : null,
    rel?.label ? `Label: ${rel.label}` : null,
    rg.genres.length ? `Genres (community tags): ${rg.genres.join(", ")}` : null,
  ].filter(Boolean) as string[];
  if (rel?.tracks.length) {
    lines.push("Tracklist:");
    for (const t of rel.tracks) lines.push(`${t.position}. ${t.title}`);
  }
  if (rel?.artistCredits.length) {
    lines.push("Credits:");
    for (const c of rel.artistCredits) lines.push(`- ${c.role}: ${c.name}`);
  }
  return lines.join("\n");
}

async function upsertPerson(
  db: DB,
  p: { mbid?: string; discogsId?: number; name: string },
): Promise<number> {
  const where = p.mbid ? eq(persons.mbid, p.mbid) : eq(persons.discogsId, p.discogsId!);
  const found = await db.query.persons.findFirst({ where });
  if (found) return found.id;
  const [row] = await db
    .insert(persons)
    .values({ mbid: p.mbid ?? null, discogsId: p.discogsId ?? null, name: p.name })
    .returning({ id: persons.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// 2) "노트 만들기" → job 생성
// ---------------------------------------------------------------------------

export async function monthSpend(db: DB, now = new Date()): Promise<number> {
  const prefix = now.toISOString().slice(0, 7);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usage.estCost}), 0)` })
    .from(usage)
    .where(like(usage.date, `${prefix}%`));
  return row?.total ?? 0;
}

export function monthlyBudget(): number | null {
  const v = Number(process.env.MONTHLY_BUDGET_USD);
  return v > 0 ? v : null;
}

export type StartResult =
  | { ok: true }
  | { ok: false; reason: "budget"; spend: number; budget: number };

export async function startNote(
  db: DB,
  releaseId: string,
  { force = false, refetch = false } = {},
): Promise<StartResult> {
  const budget = monthlyBudget();
  if (budget !== null && !force) {
    const spend = await monthSpend(db);
    if (spend >= budget) return { ok: false, reason: "budget", spend, budget };
  }
  const now = Date.now();
  const wanted = [
    ...FETCH_SOURCES.map((s) => ({ type: "fetch" as const, target: s })),
    { type: "summarize" as const, target: SUMMARY_SECTION },
  ];
  for (const w of wanted) {
    const existing = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.entityType, ENTITY),
        eq(jobs.entityId, releaseId),
        eq(jobs.type, w.type),
        eq(jobs.target, w.target),
      ),
    });
    if (!existing) {
      await db.insert(jobs).values({ entityType: ENTITY, entityId: releaseId, ...w });
      continue;
    }
    // 다시 생성: summarize는 항상 재실행. fetch는 refetch이거나 실패했을 때만 재실행(저장된 원문 재사용).
    const rerun = w.type === "summarize" || refetch || existing.status === "failed";
    if (rerun && existing.status !== "running") {
      await db
        .update(jobs)
        .set({ status: "pending", error: null, updatedAt: now })
        .where(eq(jobs.id, existing.id));
    }
  }
  await db
    .update(releases)
    .set({ noteStatus: "building" })
    .where(eq(releases.id, releaseId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 3) job 하나 실행
// ---------------------------------------------------------------------------

export async function listJobs(db: DB, releaseId: string): Promise<Job[]> {
  return db.query.jobs.findMany({
    where: and(eq(jobs.entityType, ENTITY), eq(jobs.entityId, releaseId)),
    orderBy: jobs.id,
  });
}

/** 다음에 실행할 수 있는 job을 고른다 (순수 함수, 테스트 대상). */
export function pickRunnable(all: Job[]): Job | null {
  const fetches = all.filter((j) => j.type === "fetch");
  const nextFetch = fetches.find((j) => j.status === "pending");
  if (nextFetch) return nextFetch;
  const fetchesSettled = fetches.every((j) => j.status === "done" || j.status === "failed");
  if (!fetchesSettled) return null;
  return all.find((j) => j.type === "summarize" && j.status === "pending") ?? null;
}

async function claim(db: DB, job: Job): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "running", attempts: job.attempts + 1, updatedAt: Date.now() })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

async function finish(db: DB, id: number, status: Job["status"], error: string | null = null) {
  await db.update(jobs).set({ status, error, updatedAt: Date.now() }).where(eq(jobs.id, id));
}

export async function runNextJob(db: DB, releaseId: string): Promise<{ ran: Job | null }> {
  // 함수가 시간 제한으로 죽어 running에 남은 job을 되살린다.
  await db
    .update(jobs)
    .set({ status: "pending", updatedAt: Date.now() })
    .where(
      and(
        eq(jobs.entityType, ENTITY),
        eq(jobs.entityId, releaseId),
        eq(jobs.status, "running"),
        lt(jobs.updatedAt, Date.now() - STALE_RUNNING_MS),
      ),
    );

  const job = pickRunnable(await listJobs(db, releaseId));
  if (!job || !(await claim(db, job))) return { ran: null };

  try {
    const release = await db.query.releases.findFirst({ where: eq(releases.id, releaseId) });
    if (!release) throw new Error("앨범 정보를 찾을 수 없습니다.");
    let status: Job["status"] = "done";
    if (job.type === "fetch" && job.target === "wikipedia") status = await fetchWikipedia(db, release);
    else if (job.type === "fetch" && job.target === "discogs") status = await fetchDiscogs(db, release);
    else if (job.type === "summarize") await summarizeAlbum(db, release);
    else throw new Error(`알 수 없는 job: ${job.type}:${job.target}`);
    await finish(db, job.id, status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job.type === "fetch") {
      await saveRaw(db, releaseId, job.target, { status: "failed", error: msg });
    }
    await finish(db, job.id, "failed", msg);
  }

  await refreshNoteStatus(db, releaseId);
  return { ran: job };
}

async function refreshNoteStatus(db: DB, releaseId: string) {
  const all = await listJobs(db, releaseId);
  const summary = all.find((j) => j.type === "summarize");
  if (!summary) return;
  const hasNote = await db.query.notes.findFirst({
    where: and(eq(notes.entityType, ENTITY), eq(notes.entityId, releaseId)),
  });
  const status =
    summary.status === "done" ? "ready" : summary.status === "failed" ? (hasNote ? "ready" : "none") : "building";
  await db.update(releases).set({ noteStatus: status }).where(eq(releases.id, releaseId));
}

// ---- source_raw 헬퍼 ----

type RawPatch = {
  status: (typeof sourceRaw.$inferSelect)["status"];
  url?: string | null;
  rawText?: string | null;
  meta?: unknown;
  error?: string | null;
};

async function saveRaw(db: DB, releaseId: string, source: string, p: RawPatch) {
  const values = {
    status: p.status,
    url: p.url ?? null,
    rawText: p.rawText ?? null,
    metaJson: p.meta === undefined ? null : JSON.stringify(p.meta),
    error: p.error ?? null,
    fetchedAt: Date.now(),
  };
  await db
    .insert(sourceRaw)
    .values({ entityType: ENTITY, entityId: releaseId, source, ...values })
    .onConflictDoUpdate({
      target: [sourceRaw.entityType, sourceRaw.entityId, sourceRaw.source],
      set: values,
    });
}

async function getRaw(db: DB, releaseId: string, source: string) {
  return db.query.sourceRaw.findFirst({
    where: and(
      eq(sourceRaw.entityType, ENTITY),
      eq(sourceRaw.entityId, releaseId),
      eq(sourceRaw.source, source),
    ),
  });
}

interface ChoiceMeta<C> {
  candidates?: C[];
  /** 사용자가 고른 값. null = 건너뜀 */
  chosen?: string | number | null;
}

function readMeta<C>(raw: { metaJson: string | null } | undefined): ChoiceMeta<C> {
  if (!raw?.metaJson) return {};
  try {
    return JSON.parse(raw.metaJson) as ChoiceMeta<C>;
  } catch {
    return {};
  }
}

type Release = typeof releases.$inferSelect;

function relsOf(release: Release): { group: mb.UrlRel[]; release: mb.UrlRel[] } {
  try {
    const v = JSON.parse(release.urlRelsJson);
    return { group: v.group ?? [], release: v.release ?? [] };
  } catch {
    return { group: [], release: [] };
  }
}

// ---- fetch:wikipedia ----

async function fetchWikipedia(db: DB, release: Release): Promise<Job["status"]> {
  const prev = readMeta<wiki.WikiCandidate>(await getRaw(db, release.id, "wikipedia"));
  let title: string | null = null;
  let verify = false;

  if (prev.chosen !== undefined) {
    if (prev.chosen === null) {
      await saveRaw(db, release.id, "wikipedia", { status: "not_found", meta: prev });
      return "done";
    }
    title = String(prev.chosen);
  } else {
    const rels = relsOf(release);
    const r = await wiki.resolveTitle(db, rels.group, release.title, release.artistCredit);
    if (r.kind === "none") {
      await saveRaw(db, release.id, "wikipedia", { status: "not_found" });
      return "done";
    }
    if (r.kind === "candidates") {
      await saveRaw(db, release.id, "wikipedia", {
        status: "needs_choice",
        meta: { candidates: r.candidates },
      });
      return "waiting";
    }
    title = r.title;
    verify = r.via === "search";
  }

  const page = await wiki.fetchExtract(db, title);
  if (!page) {
    await saveRaw(db, release.id, "wikipedia", { status: "not_found", meta: prev });
    return "done";
  }
  if (verify && !wiki.leadMentions(page.text, release.artistCredit)) {
    // 검색으로 찾은 문서 도입부에 아티스트가 안 나오면 자동 확정하지 않는다.
    await saveRaw(db, release.id, "wikipedia", {
      status: "needs_choice",
      meta: { candidates: [{ title: page.title, snippet: page.text.slice(0, 200) }] },
    });
    return "waiting";
  }
  await saveRaw(db, release.id, "wikipedia", {
    status: "ok",
    url: wiki.pageUrl(page.title),
    rawText: page.text,
    meta: { ...prev, title: page.title },
  });
  return "done";
}

// ---- fetch:discogs ----

async function fetchDiscogs(db: DB, release: Release): Promise<Job["status"]> {
  const prev = readMeta<discogs.DiscogsCandidate>(await getRaw(db, release.id, "discogs"));
  let ref: discogs.DiscogsRef | null = null;

  if (prev.chosen !== undefined) {
    if (prev.chosen === null) {
      await saveRaw(db, release.id, "discogs", { status: "not_found", meta: prev });
      return "done";
    }
    ref = { kind: "master", id: Number(prev.chosen) };
  } else {
    const rels = relsOf(release);
    ref = discogs.pickRef(rels.release, rels.group);
    if (!ref) {
      const candidates = await discogs.search(db, release.title, release.artistCredit);
      if (!candidates.length) {
        await saveRaw(db, release.id, "discogs", { status: "not_found" });
        return "done";
      }
      const picked = discogs.pickSearchMatch(candidates, release.title, release.artistCredit);
      if (picked === null) {
        await saveRaw(db, release.id, "discogs", { status: "needs_choice", meta: { candidates } });
        return "waiting";
      }
      ref = { kind: "master", id: picked };
    }
  }

  const releaseId =
    ref.kind === "release" ? ref.id : await discogs.getMasterMainRelease(db, ref.id);
  const data = await discogs.getRelease(db, releaseId);
  const parsed = discogs.parseCredits(data);

  await db.transaction(async (tx) => {
    await tx
      .delete(credits)
      .where(and(eq(credits.releaseId, release.id), eq(credits.source, "discogs")));
    for (const c of parsed) {
      const personId = await upsertPerson(tx as unknown as DB, { discogsId: c.discogsId, name: c.name });
      await tx.insert(credits).values({
        releaseId: release.id,
        personId,
        role: c.role,
        tracks: c.tracks,
        source: "discogs",
      });
    }
  });
  await saveRaw(db, release.id, "discogs", {
    status: "ok",
    url: data.uri ?? discogs.releasePageUrl(data.id),
    rawText: discogs.releaseToText(data),
    meta: { ...prev, discogsReleaseId: data.id },
  });
  return "done";
}

/** 사용자가 매칭 후보를 고르거나(choice) 건너뜀(null) */
export async function chooseCandidate(
  db: DB,
  releaseId: string,
  source: FetchSource,
  choice: string | number | null,
) {
  const raw = await getRaw(db, releaseId, source);
  const meta = readMeta<unknown>(raw);
  await saveRaw(db, releaseId, source, { status: "needs_choice", meta: { ...meta, chosen: choice } });
  await db
    .update(jobs)
    .set({ status: "pending", error: null, updatedAt: Date.now() })
    .where(
      and(
        eq(jobs.entityType, ENTITY),
        eq(jobs.entityId, releaseId),
        eq(jobs.type, "fetch"),
        eq(jobs.target, source),
      ),
    );
}

/** 실패했거나 자료가 없던 소스 "다시 시도". 이전 매칭 선택(건너뛰기 포함)도 지우고 처음부터 찾는다. */
export async function retrySource(db: DB, releaseId: string, source: FetchSource) {
  await db
    .delete(sourceRaw)
    .where(
      and(
        eq(sourceRaw.entityType, ENTITY),
        eq(sourceRaw.entityId, releaseId),
        eq(sourceRaw.source, source),
        inArray(sourceRaw.status, ["failed", "not_found"]),
      ),
    );
  await db
    .update(jobs)
    .set({ status: "pending", error: null, updatedAt: Date.now() })
    .where(
      and(
        eq(jobs.entityType, ENTITY),
        eq(jobs.entityId, releaseId),
        eq(jobs.type, "fetch"),
        eq(jobs.target, source),
        inArray(jobs.status, ["failed", "done"]),
      ),
    );
}

// ---- summarize:album ----

const SOURCE_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  discogs: "Discogs",
  musicbrainz: "MusicBrainz",
};

async function summarizeAlbum(db: DB, release: Release) {
  const raws = await db.query.sourceRaw.findMany({
    where: and(eq(sourceRaw.entityType, ENTITY), eq(sourceRaw.entityId, release.id)),
  });
  const ok = raws.filter((r) => r.status === "ok" && r.rawText);
  const docs: SourceDoc[] = ok.map((r) => ({
    label: SOURCE_LABELS[r.source] ?? r.source,
    url: r.url,
    text: r.rawText!,
  }));
  const sourcesJson = JSON.stringify(docs.map((d) => ({ label: d.label, url: d.url })));

  // 서술 소스(Wikipedia/Discogs)가 하나도 없으면 LLM을 호출하지 않는다.
  const hasNarrative = ok.some((r) => r.source !== "musicbrainz");
  if (!hasNarrative) {
    await saveNote(db, release.id, "summary", NO_DATA, "[]", null);
    await saveNote(db, release.id, "background", NO_DATA, "[]", null);
    return;
  }

  const gloss = await db.select().from(glossary);
  const result = await generateAlbumNote(
    { title: release.title, artist: release.artistCredit, year: release.year },
    docs,
    gloss,
  );
  await recordUsage(db, result.usage.input_tokens +
    (result.usage.cache_creation_input_tokens ?? 0) +
    (result.usage.cache_read_input_tokens ?? 0), result.usage.output_tokens, result.cost);
  await saveNote(db, release.id, "summary", result.output.summary.trim() || NO_DATA, sourcesJson, result.model);
  await saveNote(db, release.id, "background", result.output.background.trim() || NO_DATA, sourcesJson, result.model);
}

async function saveNote(
  db: DB,
  releaseId: string,
  section: string,
  content: string,
  sourcesJson: string,
  model: string | null,
) {
  const values = { contentKo: content, sourcesJson, model, createdAt: Date.now() };
  await db
    .insert(notes)
    .values({ entityType: ENTITY, entityId: releaseId, section, ...values })
    .onConflictDoUpdate({
      target: [notes.entityType, notes.entityId, notes.section],
      set: values,
    });
}

export async function recordUsage(
  db: DB,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  now = new Date(),
) {
  const date = now.toISOString().slice(0, 10);
  await db
    .insert(usage)
    .values({ date, inputTokens, outputTokens, estCost: cost })
    .onConflictDoUpdate({
      target: usage.date,
      set: {
        inputTokens: sql`${usage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${usage.outputTokens} + ${outputTokens}`,
        estCost: sql`${usage.estCost} + ${cost}`,
      },
    });
}
