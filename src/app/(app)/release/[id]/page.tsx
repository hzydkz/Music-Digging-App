import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getReleaseView, touchRelease } from "@/lib/queries";
import { NO_DATA, apiAvailable, getManualPrompt } from "@/lib/pipeline";
import { Cover } from "@/components/cover";
import { NoteRunner } from "@/components/note-runner";
import { NoteText, type NoteSource } from "@/components/note-text";

export const dynamic = "force-dynamic";

function formatLength(ms: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function parseSources(json: string | undefined): NoteSource[] {
  try {
    return json ? (JSON.parse(json) as NoteSource[]) : [];
  } catch {
    return [];
  }
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="mb-3 flex items-baseline gap-2 text-xl font-bold">
        {title}
        {badge && <span className="text-sm font-normal text-muted">{badge}</span>}
      </h2>
      {children}
    </section>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-busy="true">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

export default async function ReleasePage({ params }: PageProps<"/release/[id]">) {
  const { id } = await params;
  const db = getDb();
  const view = await getReleaseView(db, id);
  if (!view) notFound();
  await touchRelease(db, id);

  const { release, genres, tracks, credits, notes, state } = view;
  const summaryJob = state.jobs.find((j) => j.type === "summarize");
  const writing = summaryJob && (summaryJob.status === "pending" || summaryJob.status === "running");
  const blocked = state.jobs.some((j) => j.status === "waiting");
  const pendingLabel = blocked ? "위에서 문서를 고르면 이어서 작성합니다." : "자료를 모으고 요약하는 중…";
  const discogsJob = state.jobs.find((j) => j.target === "discogs");
  const summary = notes.summary;
  const fetchesSettled =
    state.jobs.some((j) => j.type === "fetch") &&
    state.jobs.filter((j) => j.type === "fetch").every((j) => j.status === "done" || j.status === "failed");
  const manualPrompt = fetchesSettled ? await getManualPrompt(db, id) : null;
  const background = notes.background;

  return (
    <article className="mx-auto max-w-[720px] space-y-6 py-6">
      <header className="grid grid-cols-[minmax(0,140px)_1fr] gap-4 sm:grid-cols-[200px_1fr] sm:gap-6">
        <Cover src={release.coverUrl} alt={`${release.title} 커버`} />
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl leading-tight font-bold sm:text-3xl">{release.title}</h1>
          <p className="text-lg">{release.artistCredit}</p>
          <p className="text-muted">
            {[release.year, release.label, release.primaryType].filter(Boolean).join(" · ")}
          </p>
          {genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {genres.map((g) => (
                <li key={g} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-sm text-muted">
                  {g}
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1 text-sm text-muted">
            <a href={`https://musicbrainz.org/release-group/${release.id}`} target="_blank" rel="noreferrer" className="underline">
              MusicBrainz
            </a>
          </p>
        </div>
      </header>

      <NoteRunner
        releaseId={release.id}
        initial={state}
        apiAvailable={apiAvailable()}
        manualPrompt={manualPrompt}
        hasNote={Boolean(summary || background)}
      />

      {(summary || writing) && (
        <Section title="한 줄 요약">
          {summary && !writing ? (
            <NoteText text={summary.contentKo} sources={parseSources(summary.sourcesJson)} />
          ) : (
            <Pending label={blocked ? pendingLabel : "작성 중…"} />
          )}
        </Section>
      )}

      {(background || writing) && (
        <Section title="제작 배경">
          {background && !writing ? (
            <>
              <NoteText text={background.contentKo} sources={parseSources(background.sourcesJson)} />
              {background.contentKo !== NO_DATA && (
                <p className="mt-3 text-xs text-muted">
                  {background.model ?? ""} · {new Date(background.createdAt).toLocaleDateString("ko-KR")} 생성 · 원문 대조는 소스 배지를 누르세요.
                </p>
              )}
            </>
          ) : (
            <Pending label={pendingLabel} />
          )}
        </Section>
      )}

      <Section title="크레딧" badge={credits.some((c) => c.roles.some((r) => r.source === "discogs")) ? "Discogs · MusicBrainz" : "MusicBrainz"}>
        {discogsJob && (discogsJob.status === "pending" || discogsJob.status === "running") && (
          <p className="mb-2 text-sm text-muted">Discogs 크레딧 수집 중…</p>
        )}
        {credits.length === 0 ? (
          <p className="text-muted">{NO_DATA}</p>
        ) : (
          <ul className="divide-y divide-line">
            {credits.map((c) => (
              <li key={c.personId} className="py-2">
                <span className="font-medium">{c.name}</span>
                <span className="block text-[15px] text-muted">
                  {c.roles.map((r, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {r.role}
                      {r.tracks ? ` (트랙 ${r.tracks})` : ""}
                      <span className="cite">{r.source === "discogs" ? "Discogs" : "MusicBrainz"}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {tracks.length > 0 && (
        <Section title="트랙" badge="MusicBrainz">
          <ol className="divide-y divide-line">
            {tracks.map((t) => (
              <li key={t.id} className="flex gap-3 py-2">
                <span className="w-10 shrink-0 text-muted tabular-nums">{t.position}</span>
                <span className="min-w-0 flex-1">{t.title}</span>
                <span className="shrink-0 text-muted tabular-nums">{formatLength(t.lengthMs)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </article>
  );
}
