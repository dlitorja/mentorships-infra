import React from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getStreamUrl } from "@mentorships/storage/src/downloads";

interface PageProps {
  params: Promise<{ token: string }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(ms: number | null): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SharedFilePage({ params }: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const { userId, getToken } = await auth();

  if (!userId) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Sign in required</h1>
          <p className="text-slate-400">Please sign in to view this shared file.</p>
        </div>
      </div>
    );
  }

  const convexToken = await getToken({ template: "convex" }) ?? undefined;

  if (!token || token.length < 16) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Invalid link</h1>
          <p className="text-slate-400">This share link is not valid.</p>
        </div>
      </div>
    );
  }

  const result = await fetchQuery(
    api.hdShareLinks.resolveShareByToken,
    { token },
    { token: convexToken }
  );

  if (!result || result.kind === "unauthenticated") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Sign in required</h1>
          <p className="text-slate-400">Please sign in to view this shared file.</p>
        </div>
      </div>
    );
  }

  if (result.kind === "forbidden") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Editors only</h1>
          <p className="text-slate-400">
            This share link is only available to users with the video editor role.
            Ask the person who shared this link to share with the right audience, or
            contact an admin if you believe you should have access.
          </p>
        </div>
      </div>
    );
  }

  if (result.kind === "not_found") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Link not found</h1>
          <p className="text-slate-400">This share link does not exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  if (result.kind === "revoked") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Link revoked</h1>
          <p className="text-slate-400">
            The owner of this share has revoked access. Contact them to request a new link.
          </p>
        </div>
      </div>
    );
  }

  if (result.kind === "expired") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">Link expired</h1>
          <p className="text-slate-400">
            This share link expired on {formatDate(result.expiresAt)}. Contact the
            owner to request a new link.
          </p>
        </div>
      </div>
    );
  }

  if (result.kind === "file_missing") {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100 mb-2">File unavailable</h1>
          <p className="text-slate-400">
            The file associated with this share is no longer available.
          </p>
        </div>
      </div>
    );
  }

  const { share, upload } = result;

  let streamUrl: string | null = null;
  try {
    streamUrl = await getStreamUrl(upload.filename, upload.contentType, 3600);
  } catch (error) {
    console.error("Failed to generate stream URL:", error);
  }

  await fetchMutation(
    api.hdShareLinks.logShareAccess,
    {
      shareId: share.id,
      action: "view",
      ip: undefined,
      userAgent: undefined,
    },
    { token: convexToken }
  ).catch((error) => {
    console.error("Failed to log share view:", error);
  });

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-2xl font-bold text-slate-100 truncate">{upload.originalName}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-400">
            <span>{formatBytes(upload.size)}</span>
            <span>{upload.contentType}</span>
            {share.expiresAt && (
              <span className="text-amber-400">
                Link expires {formatDate(share.expiresAt)}
              </span>
            )}
            {!share.expiresAt && (
              <span className="text-emerald-400">No expiry</span>
            )}
          </div>
          {share.label && (
            <p className="mt-3 text-sm text-slate-300 italic">&ldquo;{share.label}&rdquo;</p>
          )}
        </div>

        <div className="bg-black">
          {streamUrl && upload.contentType.startsWith("video/") ? (
            <video src={streamUrl} controls preload="metadata" className="w-full" />
          ) : streamUrl ? (
            <div className="p-8 text-center text-slate-400">
              <p>Preview not available for this file type.</p>
              <p className="text-sm mt-2">Use the download button below to save the file.</p>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400">
              <p>Unable to load preview.</p>
              <p className="text-sm mt-2">Use the download button below to save the file.</p>
            </div>
          )}
        </div>

        <div className="p-6 flex flex-wrap gap-3 justify-end">
          <form action={`/api/shared/${encodeURIComponent(token)}`} method="POST">
            <button
              type="submit"
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
            >
              Download
            </button>
          </form>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500 text-center">
        Your access is logged for audit purposes. Do not share this link outside the editor team.
      </p>
    </div>
  );
}
