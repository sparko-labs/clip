import { serverEnv } from "@cap/env";
import type { OAuthConfig } from "next-auth/providers/oauth";

export const OIDC_PROVIDER_ID = "oidc";

export type OidcProfile = {
	sub: string;
	email?: string;
	email_verified?: boolean | string;
	name?: string;
	given_name?: string;
	family_name?: string;
	preferred_username?: string;
	picture?: string;
};

export function oidcProvider(): OAuthConfig<OidcProfile> {
	const env = serverEnv();
	const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } = env;
	if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) {
		throw new Error(
			"AUTH_MODE=oidc requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET",
		);
	}
	const issuer = OIDC_ISSUER.replace(/\/+$/, "");

	return {
		id: OIDC_PROVIDER_ID,
		name: env.OIDC_PROVIDER_NAME ?? "Single sign-on",
		type: "oauth",
		issuer,
		wellKnown: `${issuer}/.well-known/openid-configuration`,
		authorization: { params: { scope: env.OIDC_SCOPES } },
		idToken: true,
		checks: ["pkce", "state"],
		clientId: OIDC_CLIENT_ID,
		clientSecret: OIDC_CLIENT_SECRET,
		allowDangerousEmailAccountLinking: env.OIDC_LINK_BY_EMAIL,
		profile(profile) {
			const name =
				profile.name ||
				[profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
				profile.preferred_username ||
				null;
			return {
				id: profile.sub,
				name,
				email: profile.email?.trim().toLowerCase() ?? null,
				image: profile.picture ?? null,
			};
		},
	};
}
