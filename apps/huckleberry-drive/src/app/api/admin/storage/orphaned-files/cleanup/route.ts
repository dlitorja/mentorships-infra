import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";

const CleanupRequestSchema = z.object({
  keys: z.array(z.string()).min(1),
});

interface B2Auth {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
}

let b2AuthCache: B2Auth | null = null;
let b2AuthCacheTime: number = 0;
const B2_AUTH_CACHE_TTL = 3600_000;

async function getB2Auth(): Promise<B2Auth> {
  if (b2AuthCache && Date.now() - b2AuthCacheTime < B2_AUTH_CACHE_TTL) {
    return b2AuthCache;
  }

  const keyId = process.env.B2_APPLICATION_KEY_ID || process.env.B2_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;

  if (!keyId || !applicationKey) {
    throw new Error("Missing B2 credentials: B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY must be set");
  }

  const credentials = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");

  const response = await fetch("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 authorization failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { accountId: string; authorizationToken: string; apiUrl: string };

  b2AuthCache = {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl: data.apiUrl,
  };
  b2AuthCacheTime = Date.now();

  return b2AuthCache;
}

async function listFileVersionsInB2(bucketId: string, prefix?: string): Promise<Array<{
  fileId: string;
  fileName: string;
  action: string;
}>> {
  const auth = await getB2Auth();
  const params = new URLSearchParams({ bucketId });
  if (prefix) params.set("prefix", prefix);

  const response = await fetch(`${auth.apiUrl}/b2api/v4/b2_list_file_versions?${params}`, {
    method: "GET",
    headers: {
      Authorization: `B2 ${auth.authorizationToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 list_file_versions failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { files: Array<{ fileId: string; fileName: string; action: string }> };
  return data.files;
}

async function deleteFileVersionFromB2(fileId: string, fileName: string): Promise<void> {
  const auth = await getB2Auth();

  const response = await fetch(`${auth.apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: "POST",
    headers: {
      Authorization: `B2 ${auth.authorizationToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId, fileName }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 delete_file_version failed: ${response.status} ${errorText}`);
  }
}

async function deleteAllVersionsFromB2ByFilename(fileName: string): Promise<{ deleted: number; errors: string[] }> {
  const bucketId = process.env.B2_BUCKET_ID;
  if (!bucketId) {
    throw new Error("B2_BUCKET_ID environment variable is required");
  }

  const versions = await listFileVersionsInB2(bucketId, fileName);
  const fileVersions = versions.filter(v => v.fileName === fileName && (v.action === "upload" || v.action === "hide"));

  const errors: string[] = [];
  let deleted = 0;

  for (const version of fileVersions) {
    try {
      await deleteFileVersionFromB2(version.fileId, fileName);
      deleted++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to delete ${version.fileId}: ${message}`);
    }
  }

  return { deleted, errors };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  try {
    await requireAdmin();

    const body = await request.json();
    const parsed = CleanupRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { keys } = parsed.data;
    const errors: string[] = [];
    let deleted = 0;

    for (const key of keys) {
      try {
        const result = await deleteAllVersionsFromB2ByFilename(key);
        deleted += result.deleted;
        if (result.errors.length > 0) {
          errors.push(...result.errors.map(e => `${key}: ${e}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${key}: ${message}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      deleted,
      failed: errors.length,
      total: keys.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Orphaned files cleanup error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}