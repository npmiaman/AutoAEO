CREATE TABLE `scan_job` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`status` text NOT NULL,
	`batchId` text NOT NULL,
	`searchesJson` text NOT NULL,
	`measurementId` text,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
