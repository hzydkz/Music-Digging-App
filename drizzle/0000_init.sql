CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`person_id` integer NOT NULL,
	`role` text NOT NULL,
	`tracks` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credits_release_idx` ON `credits` (`release_id`);--> statement-breakpoint
CREATE TABLE `glossary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`term_en` text NOT NULL,
	`term_ko` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `glossary_term_en_unique` ON `glossary` (`term_en`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_entity_target_idx` ON `jobs` (`entity_type`,`entity_id`,`type`,`target`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`section` text NOT NULL,
	`content_ko` text NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_entity_section_idx` ON `notes` (`entity_type`,`entity_id`,`section`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discogs_id` integer,
	`mbid` text,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persons_discogs_id_unique` ON `persons` (`discogs_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `persons_mbid_unique` ON `persons` (`mbid`);--> statement-breakpoint
CREATE TABLE `rate_state` (
	`source` text PRIMARY KEY NOT NULL,
	`last_called_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`release_mbid` text,
	`title` text NOT NULL,
	`artist_id` text,
	`artist_credit` text NOT NULL,
	`year` integer,
	`primary_type` text,
	`label` text,
	`cover_url` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`url_rels_json` text DEFAULT '[]' NOT NULL,
	`note_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_viewed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_raw` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`status` text NOT NULL,
	`raw_text` text,
	`meta_json` text,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_raw_entity_source_idx` ON `source_raw` (`entity_type`,`entity_id`,`source`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`position` text NOT NULL,
	`title` text NOT NULL,
	`length_ms` integer,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracks_release_idx` ON `tracks` (`release_id`);--> statement-breakpoint
CREATE TABLE `usage` (
	`date` text PRIMARY KEY NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`est_cost` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_memos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_memos_entity_idx` ON `user_memos` (`entity_type`,`entity_id`);