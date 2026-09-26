import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { credits, jobs, notes, persons, releases, sourceRaw, tracks } from "@/db/schema";
import { ENTITY } from "./pipeline";

export type LibraryItem = Pick<
  typeof releases.$inferSelect,
  "id" | "title" | "artistCredit" | "year" | "noteStatus" | "coverUrl"
>;

export async function listLibrary(db: DB): Promise<LibraryItem[]> {
  return db
    .select({
      id: releases.id,
      title: releases.title,
      artistCredit: releases.artistCredit,
      year: releases.year,
      noteStatus: releases.noteStatus,
      coverUrl: releases.coverUrl,
    })
    .from(releases)
    .orderBy(desc(releases.lastViewedAt))
    .limit(200);
}

export async function savedIds(db: DB, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(inArray(releases.id, ids));
  return new Set(rows.map((r) => r.id));
}

export interface SourceStatus {
  source: string;
  status: string;
  url: string | null;
  fetchedAt: number;
  error: string | null;
  candidates: Array<{ value: string | number; label: string; detail?: string }>;
}

export interface JobState {
  id: number;
  type: string;
  target: string;
  status: string;
  error: string | null;
}

export interface RunState {
  noteStatus: string;
  jobs: JobState[];
  sources: SourceStatus[];
}

function candidatesOf(source: string, metaJson: string | null): SourceStatus["candidates"] {
  if (!metaJson) return [];
  try {
    const meta = JSON.parse(metaJson) as { candidates?: unknown[] };
    const list = meta.candidates ?? [];
    if (source === "wikipedia") {
      return (list as Array<{ title: string; snippet: string }>).map((c) => ({
        value: c.title,
        label: c.title,
        detail: c.snippet,
      }));
    }
    if (source === "discogs") {
      return (list as Array<{ masterId: number; title: string; year: string | null }>).map((c) => ({
        value: c.masterId,
        label: c.title,
        detail: c.year ?? undefined,
      }));
    }
  } catch {
    // 무시
  }
  return [];
}

export async function getRunState(db: DB, releaseId: string): Promise<RunState | null> {
  const release = await db.query.releases.findFirst({ where: eq(releases.id, releaseId) });
  if (!release) return null;
  const [jobRows, rawRows] = await Promise.all([
    db.query.jobs.findMany({
      where: and(eq(jobs.entityType, ENTITY), eq(jobs.entityId, releaseId)),
      orderBy: jobs.id,
    }),
    db.query.sourceRaw.findMany({
      where: and(eq(sourceRaw.entityType, ENTITY), eq(sourceRaw.entityId, releaseId)),
    }),
  ]);
  return {
    noteStatus: release.noteStatus,
    jobs: jobRows.map((j) => ({
      id: j.id,
      type: j.type,
      target: j.target,
      status: j.status,
      error: j.error,
    })),
    sources: rawRows.map((r) => ({
      source: r.source,
      status: r.status,
      url: r.url,
      fetchedAt: r.fetchedAt,
      error: r.error,
      candidates: r.status === "needs_choice" ? candidatesOf(r.source, r.metaJson) : [],
    })),
  };
}

export interface CreditGroup {
  name: string;
  personId: number;
  roles: Array<{ role: string; tracks: string | null; source: string }>;
}

export async function getReleaseView(db: DB, releaseId: string) {
  const release = await db.query.releases.findFirst({ where: eq(releases.id, releaseId) });
  if (!release) return null;

  const [trackRows, creditRows, noteRows, state] = await Promise.all([
    db.select().from(tracks).where(eq(tracks.releaseId, releaseId)).orderBy(asc(tracks.sortOrder)),
    db
      .select({
        personId: persons.id,
        name: persons.name,
        role: credits.role,
        tracks: credits.tracks,
        source: credits.source,
      })
      .from(credits)
      .innerJoin(persons, eq(credits.personId, persons.id))
      .where(eq(credits.releaseId, releaseId))
      .orderBy(asc(credits.id)),
    db.query.notes.findMany({
      where: and(eq(notes.entityType, ENTITY), eq(notes.entityId, releaseId)),
    }),
    getRunState(db, releaseId),
  ]);

  // Discogs 크레딧이 있으면 그것을 기본으로, MusicBrainz 크레딧은 Discogs에 없는 사람만 덧붙인다.
  const groups = new Map<string, CreditGroup>();
  const ordered = [
    ...creditRows.filter((c) => c.source === "discogs"),
    ...creditRows.filter((c) => c.source !== "discogs"),
  ];
  for (const c of ordered) {
    const key = c.name.toLowerCase();
    if (c.source === "musicbrainz" && groups.get(key)?.roles.some((r) => r.source === "discogs")) continue;
    const g = groups.get(key) ?? { name: c.name, personId: c.personId, roles: [] };
    g.roles.push({ role: c.role, tracks: c.tracks, source: c.source });
    groups.set(key, g);
  }

  const noteMap = Object.fromEntries(noteRows.map((n) => [n.section, n]));
  let genres: string[] = [];
  try {
    genres = JSON.parse(release.genresJson);
  } catch {
    // 무시
  }

  return {
    release,
    genres,
    tracks: trackRows,
    credits: [...groups.values()],
    notes: noteMap as Record<string, (typeof noteRows)[number] | undefined>,
    state: state!,
  };
}

export async function touchRelease(db: DB, releaseId: string) {
  await db.update(releases).set({ lastViewedAt: Date.now() }).where(eq(releases.id, releaseId));
}
