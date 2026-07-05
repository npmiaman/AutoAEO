CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`kind` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
