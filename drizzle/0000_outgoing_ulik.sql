CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`shopId` text NOT NULL,
	`playbook` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`metricsJson` text,
	`errorMessage` text,
	`startedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `change_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`beforeJson` text,
	`afterJson` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`appliedAt` integer,
	`errorMessage` text,
	FOREIGN KEY (`runId`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experiment` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`goalId` text,
	`playbook` text NOT NULL,
	`hypothesis` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`changeJson` text,
	`snapshotJson` text,
	`baselineAppeared` integer,
	`resultAppeared` integer,
	`gainedJson` text,
	`lostJson` text,
	`verdict` text,
	`notes` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goalId`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`targetQueriesJson` text,
	`targetKeywordsJson` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `measurement` (
	`id` text PRIMARY KEY NOT NULL,
	`siteId` text NOT NULL,
	`experimentId` text,
	`goalId` text,
	`signal` text NOT NULL,
	`appeared` integer NOT NULL,
	`total` integer NOT NULL,
	`detailJson` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experimentId`) REFERENCES `experiment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goalId`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `shop` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`shopDomain` text NOT NULL,
	`name` text,
	`email` text,
	`accessTokenEnc` text NOT NULL,
	`scope` text NOT NULL,
	`installedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastSyncedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_shopDomain_unique` ON `shop` (`shopDomain`);--> statement-breakpoint
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`primaryDomain` text NOT NULL,
	`shopId` text,
	`apiKey` text,
	`configJson` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastLoopAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_apiKey_unique` ON `site` (`apiKey`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()),
	`updatedAt` integer DEFAULT (unixepoch())
);
