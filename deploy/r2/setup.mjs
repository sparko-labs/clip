#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const r2Endpoint = (accountId) =>
	`https://${accountId}.r2.cloudflarestorage.com`;

export const deriveSecretAccessKey = (apiToken) =>
	createHash("sha256").update(apiToken).digest("hex");

export const corsRules = (origins) => [
	{
		AllowedOrigins: origins,
		AllowedMethods: ["GET", "PUT", "HEAD"],
		AllowedHeaders: ["*"],
		ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
		MaxAgeSeconds: 3600,
	},
];

export const parseOrigins = (value) =>
	(value ?? "")
		.split(",")
		.map((origin) => origin.trim().replace(/\/+$/, ""))
		.filter(Boolean);

export const envFile = ({ accountId, bucket, accessKeyId, secretAccessKey }) =>
	[
		`CAP_AWS_ACCESS_KEY=${accessKeyId}`,
		`CAP_AWS_SECRET_KEY=${secretAccessKey}`,
		`CAP_AWS_BUCKET=${bucket}`,
		"CAP_AWS_REGION=auto",
		`S3_PUBLIC_ENDPOINT=${r2Endpoint(accountId)}`,
		`S3_INTERNAL_ENDPOINT=${r2Endpoint(accountId)}`,
		"S3_PATH_STYLE=true",
		"S3_FORCE_PUT_UPLOADS=true",
		"",
	].join("\n");

async function cloudflareTokenId(accountId, apiToken) {
	for (const path of [
		`/accounts/${accountId}/tokens/verify`,
		"/user/tokens/verify",
	]) {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4${path}`,
			{
				headers: { Authorization: `Bearer ${apiToken}` },
			},
		);
		if (!response.ok) continue;
		const body = await response.json();
		if (body?.result?.id && body.result.status === "active") {
			return body.result.id;
		}
	}
	throw new Error(
		"The Cloudflare API token could not be verified as an active token",
	);
}

async function resolveCredentials(env) {
	if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
		return {
			accessKeyId: env.R2_ACCESS_KEY_ID,
			secretAccessKey: env.R2_SECRET_ACCESS_KEY,
			derived: false,
		};
	}
	if (!env.CLOUDFLARE_API_TOKEN) {
		throw new Error(
			"Set CLOUDFLARE_API_TOKEN, or R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY",
		);
	}
	return {
		accessKeyId: await cloudflareTokenId(
			env.CLOUDFLARE_ACCOUNT_ID,
			env.CLOUDFLARE_API_TOKEN,
		),
		secretAccessKey: deriveSecretAccessKey(env.CLOUDFLARE_API_TOKEN),
		derived: true,
	};
}

const step = (message) => console.log(`- ${message}`);

async function expectOk(label, response) {
	if (!response.ok) {
		throw new Error(
			`${label} failed: HTTP ${response.status} ${await response.text()}`,
		);
	}
}

async function verify({ s3, sdk, presign, bucket, origin }) {
	const key = `healthcheck/${randomBytes(6).toString("hex")}.txt`;
	const body = `clip r2 check ${new Date().toISOString()}`;

	const putUrl = await presign(
		s3,
		new sdk.PutObjectCommand({
			Bucket: bucket,
			Key: key,
			ContentType: "text/plain",
		}),
		{ expiresIn: 300 },
	);
	await expectOk(
		"presigned PUT",
		await fetch(putUrl, {
			method: "PUT",
			headers: { "Content-Type": "text/plain" },
			body,
		}),
	);
	step("presigned PUT upload works");

	const getUrl = await presign(
		s3,
		new sdk.GetObjectCommand({ Bucket: bucket, Key: key }),
		{ expiresIn: 300 },
	);
	const downloaded = await fetch(getUrl);
	await expectOk("presigned GET", downloaded);
	if ((await downloaded.text()) !== body) {
		throw new Error("presigned GET returned different content");
	}
	step("presigned GET download matches");

	const partSize = 5 * 1024 * 1024;
	const upload = await s3.send(
		new sdk.CreateMultipartUploadCommand({ Bucket: bucket, Key: `${key}.mp` }),
	);
	const partUrl = await presign(
		s3,
		new sdk.UploadPartCommand({
			Bucket: bucket,
			Key: `${key}.mp`,
			UploadId: upload.UploadId,
			PartNumber: 1,
		}),
		{ expiresIn: 300 },
	);
	const partResponse = await fetch(partUrl, {
		method: "PUT",
		body: Buffer.alloc(partSize, 1),
	});
	await expectOk("multipart part upload", partResponse);
	const etag = partResponse.headers.get("etag");
	if (!etag) throw new Error("multipart part response had no ETag");
	await s3.send(
		new sdk.CompleteMultipartUploadCommand({
			Bucket: bucket,
			Key: `${key}.mp`,
			UploadId: upload.UploadId,
			MultipartUpload: { Parts: [{ ETag: etag, PartNumber: 1 }] },
		}),
	);
	step("multipart upload with presigned parts works");

	if (origin) {
		const preflight = await fetch(putUrl, {
			method: "OPTIONS",
			headers: {
				Origin: origin,
				"Access-Control-Request-Method": "PUT",
				"Access-Control-Request-Headers": "content-type",
			},
		});
		const allowed = preflight.headers.get("access-control-allow-origin");
		if (allowed !== origin) {
			throw new Error(
				`CORS preflight for ${origin} returned "${allowed ?? "no header"}"`,
			);
		}
		step(`browser CORS preflight allowed for ${origin}`);
	}

	await s3.send(
		new sdk.DeleteObjectsCommand({
			Bucket: bucket,
			Delete: { Objects: [{ Key: key }, { Key: `${key}.mp` }] },
		}),
	);
	step("test objects removed");
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) throw new Error("Set CLOUDFLARE_ACCOUNT_ID");
	const bucket = env.R2_BUCKET || "clip-videos";
	const origins = parseOrigins(env.WEB_ORIGINS || "https://clip.sparkosol.co");
	const writeEnvIndex = argv.indexOf("--write-env");
	const writeEnv = writeEnvIndex >= 0 ? argv[writeEnvIndex + 1] : null;

	const sdk = await import("@aws-sdk/client-s3");
	const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
	const credentials = await resolveCredentials(env);
	const s3 = new sdk.S3Client({
		region: "auto",
		endpoint: r2Endpoint(accountId),
		forcePathStyle: true,
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
		credentials: {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
		},
	});

	const exists = await s3
		.send(new sdk.HeadBucketCommand({ Bucket: bucket }))
		.then(() => true)
		.catch((error) => {
			if (error?.$metadata?.httpStatusCode === 404) return false;
			throw error;
		});
	if (exists) {
		step(`bucket ${bucket} exists`);
	} else {
		await s3.send(new sdk.CreateBucketCommand({ Bucket: bucket }));
		step(`bucket ${bucket} created`);
	}

	try {
		await s3.send(
			new sdk.PutBucketCorsCommand({
				Bucket: bucket,
				CORSConfiguration: { CORSRules: corsRules(origins) },
			}),
		);
		step(`CORS set for ${origins.join(", ")}`);
	} catch (error) {
		if (credentials.derived) throw error;
		step(`CORS not changed (${error?.name ?? "error"}); using existing rules`);
	}

	await verify({
		s3,
		sdk,
		presign: getSignedUrl,
		bucket,
		origin: origins[0],
	});

	const lines = envFile({
		accountId,
		bucket,
		accessKeyId: credentials.accessKeyId,
		secretAccessKey: credentials.secretAccessKey,
	});
	if (writeEnv) {
		writeFileSync(writeEnv, lines, { mode: 0o600 });
		console.log(`\nWrote ${writeEnv} (mode 600). Merge it into deploy/.env.`);
	} else {
		console.log(
			"\nRe-run with --write-env <file> to save the connection settings.",
		);
	}
	if (credentials.derived) {
		console.log(
			"These credentials come from your Cloudflare API token and can reach every bucket in the account.\n" +
				"For least privilege create a bucket-scoped R2 token (Object Read & Write) in the dashboard and re-run with R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
		);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`\nFailed: ${error?.message ?? error}`);
		process.exitCode = 1;
	});
}
