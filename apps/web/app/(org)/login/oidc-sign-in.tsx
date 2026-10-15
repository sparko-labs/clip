"use client";

import { Button, LogoBadge } from "@cap/ui";
import { signIn } from "next-auth/react";
import { useEffect, useRef } from "react";

const ERROR_MESSAGES: Record<string, string> = {
	OidcNotInDirectory: "Your account is not part of this organization.",
	OidcEmailUnverified:
		"Your email address has not been verified by the identity provider.",
	OidcEmailMissing: "The identity provider did not return an email address.",
	OidcAccessDisabled: "Your access to this service has been disabled.",
	OAuthAccountNotLinked:
		"This email is already registered. Ask an administrator to link it to single sign-on.",
	AccessDenied: "You do not have access to this service.",
};

export function OidcSignIn({
	callbackUrl,
	error,
	providerName,
}: {
	callbackUrl: string;
	error?: string;
	providerName: string;
}) {
	const started = useRef(false);

	useEffect(() => {
		if (error || started.current) return;
		started.current = true;
		void signIn("oidc", { callbackUrl });
	}, [callbackUrl, error]);

	return (
		<div className="flex flex-col gap-4 items-center p-8 w-full max-w-sm rounded-2xl border bg-gray-1 border-gray-3">
			<LogoBadge className="w-16 h-auto" />
			{error ? (
				<>
					<p className="text-sm text-center text-gray-12">
						{ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again."}
					</p>
					<Button
						variant="primary"
						onClick={() => void signIn("oidc", { callbackUrl })}
					>
						Sign in with {providerName}
					</Button>
				</>
			) : (
				<p className="text-sm text-center text-gray-11">
					Redirecting to {providerName}…
				</p>
			)}
		</div>
	);
}
