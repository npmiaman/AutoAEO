CREATE TABLE `search_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`engine` text NOT NULL,
	`query` text NOT NULL,
	`resultJson` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `scan_job` ADD `submittedJson` text;