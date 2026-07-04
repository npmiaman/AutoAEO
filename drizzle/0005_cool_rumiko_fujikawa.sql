CREATE TABLE `cli_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`name` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastUsedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cli_token_token_unique` ON `cli_token` (`token`);