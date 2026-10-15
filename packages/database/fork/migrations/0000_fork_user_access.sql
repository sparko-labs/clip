CREATE TABLE `fork_user_access` (
	`userId` varchar(15) NOT NULL,
	`disabledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fork_user_access_userId` PRIMARY KEY(`userId`)
);
