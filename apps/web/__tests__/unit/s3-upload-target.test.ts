import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ S3_FORCE_PUT_UPLOADS: false }));

vi.mock("@cap/env", () => ({ serverEnv: () => env }));

import { makeS3Access } from "../../../../packages/web-backend/src/Storage/index";

const makeAccess = () => {
	const getPresignedPutUrl = vi.fn(() =>
		Effect.succeed("https://account.r2.example/bucket/key?X-Amz-Signature=put"),
	);
	const getPresignedPostUrl = vi.fn(() =>
		Effect.succeed({
			url: "https://account.r2.example/bucket",
			fields: { key: "key" },
		}),
	);
	const s3 = { getPresignedPutUrl, getPresignedPostUrl } as never;
	return {
		access: makeS3Access(s3),
		getPresignedPutUrl,
		getPresignedPostUrl,
	};
};

describe("S3 upload targets", () => {
	beforeEach(() => {
		env.S3_FORCE_PUT_UPLOADS = false;
	});

	it("keeps presigned POST as the default", async () => {
		const { access, getPresignedPostUrl, getPresignedPutUrl } = makeAccess();
		const target = await Effect.runPromise(
			access.createUploadTarget("key", { contentType: "video/mp4" }),
		);
		expect(target.type).toBe("s3Post");
		expect(getPresignedPostUrl).toHaveBeenCalledTimes(1);
		expect(getPresignedPutUrl).not.toHaveBeenCalled();
	});

	it("honours an explicit put request", async () => {
		const { access, getPresignedPutUrl } = makeAccess();
		const target = await Effect.runPromise(
			access.createUploadTarget("key", {
				contentType: "video/mp4",
				method: "put",
			}),
		);
		expect(target).toMatchObject({
			type: "put",
			headers: { "Content-Type": "video/mp4" },
		});
		expect(getPresignedPutUrl).toHaveBeenCalledTimes(1);
	});

	it("forces presigned PUT for post requests when configured", async () => {
		env.S3_FORCE_PUT_UPLOADS = true;
		const { access, getPresignedPostUrl, getPresignedPutUrl } = makeAccess();
		const target = await Effect.runPromise(
			access.createUploadTarget("key", {
				contentType: "image/png",
				method: "post",
				fields: { "x-amz-meta-userid": "u1" },
			}),
		);
		expect(target.type).toBe("put");
		expect(getPresignedPostUrl).not.toHaveBeenCalled();
		expect(getPresignedPutUrl).toHaveBeenCalledWith(
			"key",
			{ ContentType: "image/png" },
			{ expiresIn: 1800 },
		);
	});
});
