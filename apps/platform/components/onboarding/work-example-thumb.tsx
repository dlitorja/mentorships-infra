"use client";

import React, { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";

import { apiFetch } from "@/lib/queries/api-client";
import { ApiRoutes } from "@/lib/routes";

/**
 * Greptile P2 follow-up (round 9): render the actual image for a work
 * example, not just a placeholder icon. Fetches a short-lived signed
 * GET URL on mount via the existing
 * `/api/onboarding/[id]/work-examples/[exampleId]/download-url` route
 * and swaps the tile contents once the URL resolves. Falls back to
 * the icon if the fetch fails (network / auth / expiry) so the
 * surrounding form and admin review surfaces stay usable.
 *
 * Shared between the student-facing questionnaire form (where it
 * renders their own pending + active uploads inside the upload grid)
 * and the admin detail page's "Student questionnaire" card (where it
 * renders the student's already-submitted active images so an admin
 * can spot-check what the student attached before the first call).
 *
 * Auth: the GET route re-checks the viewer's access (student /
 * matching instructor / admin / support) on every call and mints a
 * 1h signed URL on success, so mounting this anywhere the viewer is
 * authorized is safe.
 */
export function WorkExampleThumb({
  onboardingId,
  workExampleId,
  fileName,
}: {
  onboardingId: string;
  workExampleId: string;
  fileName: string;
}): React.JSX.Element {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSignedUrl(null);
    (async () => {
      try {
        const res = await apiFetch<{ url: string }>(
          ApiRoutes.onboardingWorkExampleDownloadUrl(
            onboardingId,
            workExampleId
          ),
          { method: "GET" }
        );
        if (!cancelled) setSignedUrl(res.url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboardingId, workExampleId]);

  return (
    <>
      {signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl}
          alt={fileName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      {failed && !signedUrl && (
        <div className="absolute inset-x-0 top-0 bg-destructive/80 px-1 py-0.5 text-[10px] text-destructive-foreground">
          preview unavailable
        </div>
      )}
    </>
  );
}
