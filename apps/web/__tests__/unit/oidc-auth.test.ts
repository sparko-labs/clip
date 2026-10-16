import {
	authOptions,
	decodeSessionToken,
} from "@cap/database/auth/auth-options";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { NextRequest } from "next/server";
import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

type UserRow = { id: string; email: string; authSessionVersion: number };

const state = vi.hoisted(() => ({
	users: [] as UserRow[],
	disabled: new Set<string>(),
	select: vi.fn(),
	nextAuth: vi.fn(),
}));

const env = vi.hoisted(() => ({
	AUTH_MODE: "oidc" as "oidc" | "legacy",
	OIDC_ISSUER: "https://idp.example/realms/main/" as string | undefined,
	OIDC_CLIENT_ID: "cap-web" as string | undefined,
	OIDC_CLIENT_SECRET: "oidc-secret" as string | undefined,
	OIDC_SCOPES: "openid profile email",
	OIDC_PROVIDER_NAME: "Company SSO" as string | undefined,
	OIDC_LINK_BY_EMAIL: false,
	OIDC_ALLOWED_EMAIL_DOMAINS: "company.example" as string | undefined,
	APPLE_CLIENT_ID: "so.cap.auth",
	APPLE_CLIENT_SECRET: "apple-secret",
	CAP_ALLOWED_SIGNUP_DOMAINS: undefined as string | undefined,
	CAP_BLOCKED_SIGNUP_DOMAINS: undefined as string | undefined,
	GOOGLE_CLIENT_ID: "google-client",
	GOOGLE_CLIENT_SECRET: "google-secret",
	NEXTAUTH_SECRET: "next-auth-secret",
	WEB_URL: "https://cap.example",
	RESEND_API_KEY: undefined,
	WORKOS_API_KEY: "workos-secret",
	WORKOS_CLIENT_ID: "workos-client",
}));

vi.mock("@cap/env", () => ({ serverEnv: () => env }));
vi.mock("@cap/database", () => ({ db: () => ({ select: state.select }) }));
vi.mock("@cap/database/auth/sso", () => ({
	validateSsoSignIn: vi.fn(),
	provisionSsoMembership: vi.fn(),
	getWorkOS: vi.fn(),
}));
vi.mock("../../../../packages/database/auth/drizzle-adapter", () => ({
	DrizzleAdapter: vi.fn<() => Adapter>(() => ({})),
}));
vi.mock("next-auth", () => ({
	default: state.nextAuth,
	getServerSession: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn() }));

const OIDC_ACCOUNT = {
	provider: "oidc",
	providerAccountId: "sub-1",
	type: "oauth" as const,
};

function signInFor(options: NextAuthOptions) {
	const signIn = options.callbacks?.signIn;
	if (!signIn) throw new Error("signIn callback missing");
	return signIn;
}

function whereResult(condition: SQL) {
	return {
		limit: async () => {
			const query = new MySqlDialect().sqlToQuery(condition);
			const value = query.params[0] as string;
			if (query.sql.startsWith("`fork_user_access`.`userId`")) {
				return state.disabled.has(value) ? [{ userId: value }] : [];
			}
			const match = /^`users`\.`(id|email)` = \?$/.exec(query.sql);
			if (!match?.[1]) throw new Error(`Unexpected predicate: ${query.sql}`);
			const column = match[1] as "id" | "email";
			return state.users.filter((user) => user[column] === value);
		},
	};
}

describe("oidc mode", () => {
	beforeEach(() => {
		env.AUTH_MODE = "oidc";
		env.OIDC_ISSUER = "https://idp.example/realms/main/";
		env.OIDC_CLIENT_ID = "cap-web";
		env.OIDC_CLIENT_SECRET = "oidc-secret";
		env.OIDC_ALLOWED_EMAIL_DOMAINS = "company.example";
		env.CAP_BLOCKED_SIGNUP_DOMAINS = undefined;
		state.users = [
			{ id: "user-1", email: "alex@company.example", authSessionVersion: 0 },
		];
		state.disabled = new Set();
		state.nextAuth.mockReset();
		state.select.mockReset().mockImplementation(() => ({
			from: () => ({ where: whereResult }),
		}));
	});

	describe("providers", () => {
		it("exposes only the OIDC provider", () => {
			expect(authOptions().providers.map((provider) => provider.id)).toEqual([
				"oidc",
			]);
		});

		it("discovers the issuer without a trailing slash", () => {
			const provider = authOptions().providers[0] as unknown as {
				wellKnown: string;
				issuer: string;
				idToken: boolean;
				checks: string[];
				allowDangerousEmailAccountLinking: boolean;
			};
			expect(provider.wellKnown).toBe(
				"https://idp.example/realms/main/.well-known/openid-configuration",
			);
			expect(provider.issuer).toBe("https://idp.example/realms/main");
			expect(provider.idToken).toBe(true);
			expect(provider.checks).toEqual(["pkce", "state"]);
			expect(provider.allowDangerousEmailAccountLinking).toBe(false);
		});

		it.each(["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const)(
			"fails closed when %s is missing",
			(key) => {
				env[key] = undefined;
				expect(() => authOptions().providers).toThrow(/AUTH_MODE=oidc/);
			},
		);

		it("keeps the upstream providers in legacy mode", () => {
			env.AUTH_MODE = "legacy";
			const ids = authOptions().providers.map((provider) => provider.id);
			expect(ids).toEqual(
				expect.arrayContaining(["apple", "google", "workos", "email"]),
			);
			expect(ids).not.toContain("oidc");
		});
	});

	describe("userinfo", () => {
		const request = (tokens: unknown, client: unknown) => {
			const provider = authOptions().providers[0] as unknown as {
				userinfo: { request: (context: unknown) => Promise<unknown> };
			};
			return provider.userinfo.request({ tokens, client });
		};

		it("merges userinfo claims over the ID token claims", async () => {
			const userinfo = vi.fn().mockResolvedValue({
				sub: "sub-1",
				email: "alex@company.example",
				email_verified: true,
			});
			const result = await request(
				{ access_token: "at", claims: () => ({ sub: "sub-1", sid: "s" }) },
				{ userinfo },
			);
			expect(userinfo).toHaveBeenCalledWith("at");
			expect(result).toEqual({
				sub: "sub-1",
				sid: "s",
				email: "alex@company.example",
				email_verified: true,
			});
		});

		it("rejects a userinfo response for a different subject", async () => {
			await expect(
				request(
					{ access_token: "at", claims: () => ({ sub: "sub-1" }) },
					{ userinfo: async () => ({ sub: "someone-else", email: "x@y.z" }) },
				),
			).rejects.toThrow(/subject does not match/);
		});

		it("requires an access token", async () => {
			await expect(
				request({ claims: () => ({ sub: "sub-1" }) }, { userinfo: vi.fn() }),
			).rejects.toThrow(/no access token/);
		});
	});

	describe("profile mapping", () => {
		it("lowercases the email and falls back through name claims", () => {
			const provider = authOptions().providers[0] as unknown as {
				profile: (profile: Record<string, unknown>) => Record<string, unknown>;
			};
			expect(
				provider.profile({
					sub: "sub-1",
					email: " Alex@Company.Example ",
					given_name: "Alex",
					family_name: "Doe",
					picture: "https://idp.example/a.png",
				}),
			).toEqual({
				id: "sub-1",
				name: "Alex Doe",
				email: "alex@company.example",
				image: "https://idp.example/a.png",
			});
		});
	});

	describe("signIn callback", () => {
		const signIn = (
			overrides: {
				email?: string | null;
				emailVerified?: unknown;
				provider?: string;
			} = {},
		) =>
			signInFor(authOptions())({
				user: {
					id: "sub-1",
					email:
						overrides.email === undefined
							? "alex@company.example"
							: (overrides.email as string),
				},
				account: {
					...OIDC_ACCOUNT,
					provider: overrides.provider ?? OIDC_ACCOUNT.provider,
				},
				profile: {
					email_verified:
						"emailVerified" in overrides ? overrides.emailVerified : true,
				} as never,
			});

		it("admits a verified member of an allowed domain", async () => {
			await expect(signIn()).resolves.toBe(true);
		});

		it("accepts the string form of email_verified", async () => {
			await expect(signIn({ emailVerified: "true" })).resolves.toBe(true);
		});

		it.each([
			["false", false],
			["missing", undefined],
			["a non-boolean string", "yes"],
		])("rejects when email_verified is %s", async (_label, emailVerified) => {
			await expect(signIn({ emailVerified })).resolves.toBe(
				"/login?error=OidcEmailUnverified",
			);
		});

		it("rejects a missing email", async () => {
			await expect(signIn({ email: null })).resolves.toBe(
				"/login?error=OidcEmailMissing",
			);
		});

		it("rejects emails outside the allowed domains", async () => {
			await expect(signIn({ email: "eve@outsider.example" })).resolves.toBe(
				"/login?error=OidcNotInDirectory",
			);
		});

		it("does not treat a lookalike domain as a member", async () => {
			await expect(
				signIn({ email: "eve@company.example.attacker.test" }),
			).resolves.toBe("/login?error=OidcNotInDirectory");
			await expect(signIn({ email: "eve@evilcompany.example" })).resolves.toBe(
				"/login?error=OidcNotInDirectory",
			);
		});

		it.each([undefined, "", "   ", "not a domain"])(
			"admits nobody when the allowlist is %j",
			async (allowlist) => {
				env.OIDC_ALLOWED_EMAIL_DOMAINS = allowlist;
				await expect(signIn()).resolves.toBe("/login?error=OidcNotInDirectory");
			},
		);

		it("rejects any provider other than oidc", async () => {
			await expect(signIn({ provider: "google" })).resolves.toBe(false);
			await expect(signIn({ provider: "email" })).resolves.toBe(false);
			await expect(signIn({ provider: "workos" })).resolves.toBe(false);
		});

		it("rejects an account an administrator disabled", async () => {
			state.disabled.add("user-1");
			await expect(signIn()).resolves.toBe("/login?error=OidcAccessDisabled");
		});

		it("still applies the blocked list", async () => {
			env.CAP_BLOCKED_SIGNUP_DOMAINS = "alex@company.example";
			await expect(signIn()).resolves.toBe("/login?error=SignupBlocked");
		});
	});

	describe("existing sessions", () => {
		const tokenFor = async (email: string) => {
			const { encode } = await import("next-auth/jwt");
			const secret = env.NEXTAUTH_SECRET;
			const token = await encode({
				token: { id: "user-1", email, sessionVersion: 0 },
				secret,
			});
			return { token, secret };
		};

		it("keeps a member's session", async () => {
			const params = await tokenFor("alex@company.example");
			await expect(decodeSessionToken(params)).resolves.toMatchObject({
				id: "user-1",
			});
		});

		it("expires sessions whose email left the allowed domains", async () => {
			const params = await tokenFor("alex@company.example");
			env.OIDC_ALLOWED_EMAIL_DOMAINS = "other.example";
			await expect(decodeSessionToken(params)).resolves.toBeNull();
		});

		it("expires sessions of a disabled account", async () => {
			const params = await tokenFor("alex@company.example");
			state.disabled.add("user-1");
			await expect(decodeSessionToken(params)).resolves.toBeNull();
		});

		it("expires sessions when the allowlist is removed", async () => {
			const params = await tokenFor("alex@company.example");
			env.OIDC_ALLOWED_EMAIL_DOMAINS = undefined;
			await expect(decodeSessionToken(params)).resolves.toBeNull();
		});

		it("does not consult the access table in legacy mode", async () => {
			env.AUTH_MODE = "legacy";
			env.OIDC_ALLOWED_EMAIL_DOMAINS = undefined;
			state.disabled.add("user-1");
			const params = await tokenFor("alex@company.example");
			await expect(decodeSessionToken(params)).resolves.toMatchObject({
				id: "user-1",
			});
		});
	});

	describe("legacy auth routes", () => {
		const call = async (action: string, provider: string, method = "GET") => {
			const { GET, POST } = await import("@/app/api/auth/[...nextauth]/route");
			const request = new NextRequest(
				new URL(`/api/auth/${action}/${provider}`, env.WEB_URL),
				{ method },
			);
			const handler = method === "POST" ? POST : GET;
			return handler(request, {
				params: Promise.resolve({ nextauth: [action, provider] }),
			});
		};

		it.each([
			["signin", "google", "POST"],
			["signin", "apple", "POST"],
			["signin", "email", "POST"],
			["signin", "workos", "POST"],
			["callback", "google", "GET"],
			["callback", "apple", "POST"],
			["callback", "email", "GET"],
			["callback", "workos", "GET"],
		])("returns 404 for %s/%s", async (action, provider, method) => {
			const response = await call(action, provider, method);
			expect(response.status).toBe(404);
			expect(state.nextAuth).not.toHaveBeenCalled();
		});

		it("lets next-auth's own error redirect to the sign-in page through", async () => {
			state.nextAuth.mockResolvedValue(new Response(null, { status: 302 }));
			const { GET } = await import("@/app/api/auth/[...nextauth]/route");
			const response = await GET(
				new NextRequest(
					new URL("/api/auth/signin?error=OAuthCallback", env.WEB_URL),
				),
				{ params: Promise.resolve({ nextauth: ["signin"] }) },
			);
			expect(response.status).toBe(302);
			expect(state.nextAuth).toHaveBeenCalledTimes(1);
		});

		it("lets the oidc provider through to next-auth", async () => {
			state.nextAuth.mockResolvedValue(new Response(null, { status: 302 }));
			const response = await call("signin", "oidc", "POST");
			expect(response.status).toBe(302);
			expect(state.nextAuth).toHaveBeenCalledTimes(1);
		});

		it("does not intercept legacy routes in legacy mode", async () => {
			env.AUTH_MODE = "legacy";
			state.nextAuth.mockResolvedValue(new Response(null, { status: 302 }));
			const response = await call("signin", "google", "POST");
			expect(response.status).toBe(302);
		});
	});
});
