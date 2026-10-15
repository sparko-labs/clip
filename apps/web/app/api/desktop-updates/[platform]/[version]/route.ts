import { serverEnv } from "@cap/env";
import { NextResponse } from "next/server";
import { selectUpdate, updateManifestSchema } from "@/lib/desktop-updates";

export const dynamic = "force-dynamic";

const MANIFEST_TIMEOUT_MS = 5_000;

async function loadManifest(channel: string) {
	const base = serverEnv().DESKTOP_UPDATES_BASE_URL;
	if (!base) return null;
	const file =
		channel === "nightly" ? "manifest-nightly.json" : "manifest.json";
	try {
		const response = await fetch(`${base.replace(/\/+$/, "")}/${file}`, {
			cache: "no-store",
			signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const parsed = updateManifestSchema.safeParse(await response.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export async function GET(
	request: Request,
	context: { params: Promise<{ platform: string; version: string }> },
) {
	const { platform, version } = await context.params;
	const channel = new URL(request.url).searchParams.get("channel") ?? "stable";
	const manifest = await loadManifest(channel);
	const update = manifest ? selectUpdate(manifest, platform, version) : null;
	if (!update) return new NextResponse(null, { status: 204 });
	return NextResponse.json(update, {
		headers: { "cache-control": "no-store" },
	});
}
