CREATE TABLE `improvement_test` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`focusArea` text NOT NULL,
	`hypothesis` text NOT NULL,
	`action` text NOT NULL,
	`kpiMetric` text NOT NULL,
	`kpiQueriesJson` text NOT NULL,
	`kpiTarget` integer NOT NULL,
	`windowDays` integer NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`baselineHits` integer,
	`baselineAppearedJson` text,
	`latestHits` integer,
	`latestAppearedJson` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`evaluatedAt` integer,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
