CREATE TABLE `site_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`payloadJson` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
