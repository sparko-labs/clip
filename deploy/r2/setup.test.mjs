import assert from "node:assert/strict";
import test from "node:test";
import {
	corsRules,
	deriveSecretAccessKey,
	envFile,
	parseOrigins,
	r2Endpoint,
} from "./setup.mjs";

test("the S3 secret is the sha256 of the API token", () => {
	assert.equal(
		deriveSecretAccessKey("abc"),
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	);
});

test("the endpoint is the account S3 domain", () => {
	assert.equal(r2Endpoint("0123"), "https://0123.r2.cloudflarestorage.com");
});

test("origins are split, trimmed and stripped of trailing slashes", () => {
	assert.deepEqual(parseOrigins(" https://a.example/ , https://b.example "), [
		"https://a.example",
		"https://b.example",
	]);
	assert.deepEqual(parseOrigins(undefined), []);
});

test("cors exposes ETag so multipart uploads can complete", () => {
	const [rule] = corsRules(["https://a.example"]);
	assert.deepEqual(rule.AllowedOrigins, ["https://a.example"]);
	assert.ok(rule.ExposeHeaders.includes("ETag"));
	assert.ok(rule.AllowedMethods.includes("PUT"));
	assert.ok(!rule.AllowedMethods.includes("POST"));
});

test("the env file forces PUT uploads and path-style access", () => {
	const text = envFile({
		accountId: "acct",
		bucket: "clip-videos",
		accessKeyId: "id",
		secretAccessKey: "secret",
	});
	assert.match(text, /^S3_FORCE_PUT_UPLOADS=true$/m);
	assert.match(text, /^S3_PATH_STYLE=true$/m);
	assert.match(text, /^CAP_AWS_REGION=auto$/m);
	assert.match(
		text,
		/^S3_PUBLIC_ENDPOINT=https:\/\/acct\.r2\.cloudflarestorage\.com$/m,
	);
	assert.match(
		text,
		/^S3_INTERNAL_ENDPOINT=https:\/\/acct\.r2\.cloudflarestorage\.com$/m,
	);
});
