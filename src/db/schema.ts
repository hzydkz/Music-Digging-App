import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

export const artists = sqliteTable("artists", {
  id: text("id").primaryKey(), // MusicBrainz artist MBID
  name: text("name").notNull(),
  sortName: text("sort_name"),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * "앨범" 단위. id는 MusicBrainz release-group MBID.
 * 트랙·레이블은 대표 release(releaseMbid)에서 가져온다.
 */
export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(),
  releaseMbid: text("release_mbid"),
  title: text("title").notNull(),
  artistId: text("artist_id"),
  artistCredit: text("artist_credit").notNull(),
  year: integer("year"),
  primaryType: text("primary_type"),
  label: text("label"),
  coverUrl: text("cover_url"),
  genresJson: text("genres_json").notNull().default("[]"),
  urlRelsJson: text("url_rels_json").notNull().default("[]"),
  noteStatus: text("note_status", { enum: ["none", "building", "ready"] })
    .notNull()
    .default("none"),
  createdAt: integer("created_at").notNull().default(now),
  lastViewedAt: integer("last_viewed_at").notNull().default(now),
});

export const tracks = sqliteTable(
  "tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    releaseId: text("release_id").notNull(),
    position: text("position").notNull(),
    title: text("title").notNull(),
    lengthMs: integer("length_ms"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("tracks_release_idx").on(t.releaseId)],
);

export const persons = sqliteTable("persons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discogsId: integer("discogs_id").unique(),
  mbid: text("mbid").unique(),
  name: text("name").notNull(),
});

export const credits = sqliteTable(
  "credits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    releaseId: text("release_id").notNull(),
    personId: integer("person_id").notNull(),
    role: text("role").notNull(),
    tracks: text("tracks"),
    source: text("source", { enum: ["discogs", "musicbrainz"] }).notNull(),
  },
  (t) => [index("credits_release_idx").on(t.releaseId)],
);

export const sourceRaw = sqliteTable(
  "source_raw",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    source: text("source").notNull(),
    url: text("url"),
    fetchedAt: integer("fetched_at").notNull().default(now),
    status: text("status", {
      enum: ["ok", "failed", "not_found", "needs_choice"],
    }).notNull(),
    rawText: text("raw_text"),
    /** 매칭 후보 등 부가 정보 (JSON) */
    metaJson: text("meta_json"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("source_raw_entity_source_idx").on(
      t.entityType,
      t.entityId,
      t.source,
    ),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    section: text("section").notNull(),
    contentKo: text("content_ko").notNull(),
    sourcesJson: text("sources_json").notNull().default("[]"),
    model: text("model"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("notes_entity_section_idx").on(
      t.entityType,
      t.entityId,
      t.section,
    ),
  ],
);

export const userMemos = sqliteTable(
  "user_memos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    content: text("content").notNull().default(""),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("user_memos_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const glossary = sqliteTable("glossary", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  termEn: text("term_en").notNull().unique(),
  termKo: text("term_ko").notNull(),
  note: text("note"),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    type: text("type", { enum: ["fetch", "summarize"] }).notNull(),
    /** fetch면 소스 이름, summarize면 섹션 이름 */
    target: text("target").notNull(),
    status: text("status", {
      enum: ["pending", "running", "done", "failed", "waiting"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("jobs_entity_target_idx").on(
      t.entityType,
      t.entityId,
      t.type,
      t.target,
    ),
  ],
);

export const usage = sqliteTable("usage", {
  date: text("date").primaryKey(), // YYYY-MM-DD (UTC)
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estCost: real("est_cost").notNull().default(0),
});

export const rateState = sqliteTable("rate_state", {
  source: text("source").primaryKey(),
  lastCalledAt: integer("last_called_at").notNull().default(0),
});
