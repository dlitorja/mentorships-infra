"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/queries/api-client";
import { ApiRoutes } from "@/lib/routes";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  useCancelOnboardingArtworkExport,
  useCreateOnboardingArtworkExport,
  useOnboardingArtworkExports,
} from "@/lib/queries/convex/use-onboarding-artwork-exports";

/**
 * Reviewer gallery for a student's onboarding artwork.
 *
 * Three things the previous per-thumbnail component could not do:
 *   1. Open an image at full size (the review card only rendered
 *      cover-cropped squares).
 *   2. Save a single image as a file — the signed URL now carries a
 *      `Content-Disposition: attachment` header via `?download=1`,
 *      because the `download` attribute is ignored cross-origin.
 *   3. Download everything at once as a ZIP, built by Trigger.dev from
 *      the workspace B2 bucket (never Convex storage).
 *
 * Auth is unchanged: every URL is minted by the existing
 * `/api/onboarding/[id]/work-examples/[exampleId]/download-url` route,
 * which re-checks the viewer's access on each call.
 */
export interface WorkExampleGalleryItem {
  _id: Id<"onboardingWorkExamples">;
  fileName: string;
  /** Optional: surfaced in the lightbox caption when present. */
  size?: number;
}

function formatBytes(bytes: number | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `view` URLs render inline; `download` URLs are minted on demand and
 * carry an attachment disposition so the browser saves the file.
 */
async function fetchSignedUrl(
  onboardingId: string,
  exampleId: string,
  download: boolean
): Promise<string> {
  const base = ApiRoutes.onboardingWorkExampleDownloadUrl(onboardingId, exampleId);
  const url = download ? `${base}?download=1` : base;
  const res = await apiFetch<{ url: string }>(url, { method: "GET" });
  return res.url;
}

function isExpired(expiresAt: number | undefined): boolean {
  // No `expiresAt` means a row written before the field existed; treat
  // it as live rather than hiding a working link.
  return typeof expiresAt === "number" && expiresAt <= Date.now();
}

export function WorkExampleGallery({
  onboardingId,
  examples,
  canExportAll = true,
  className,
}: {
  onboardingId: string;
  examples: WorkExampleGalleryItem[];
  /** Hide the ZIP control on surfaces that should not offer it. */
  canExportAll?: boolean;
  className?: string;
}): React.JSX.Element {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Ids with a request in flight. Only used to avoid duplicate GETs —
  // correctness (never stranding an id) is handled by applying results
  // as long as the component is mounted, not by the `cancelled` flag
  // that used to discard them.
  const inFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const { data: exports, isLoading: exportsLoading } =
    useOnboardingArtworkExports(onboardingId as Id<"adminOnboardings">);
  const createExport = useCreateOnboardingArtworkExport();
  const cancelExport = useCancelOnboardingArtworkExport();

  const latestExport = exports?.[0];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pendingIds = useMemo(
    () =>
      examples
        .map((example) => example._id as string)
        .filter((id) => !urls[id] && !failedIds.has(id)),
    [examples, urls, failedIds]
  );
  // `pendingIds` is a fresh array each render; the joined string keeps
  // the effect from re-running when nothing actually changed.
  const pendingKey = pendingIds.join(",");

  // Prefetch every thumbnail's signed URL in parallel. Each request is
  // auth-checked server-side, so this is safe to do eagerly for the
  // current viewer.
  useEffect(() => {
    const ids = pendingKey
      ? pendingKey.split(",").filter((id) => !inFlightRef.current.has(id))
      : [];
    if (ids.length === 0) return;

    for (const id of ids) inFlightRef.current.add(id);

    (async () => {
      const results = await Promise.allSettled(
        ids.map((id) => fetchSignedUrl(onboardingId, id, false))
      );
      for (const id of ids) inFlightRef.current.delete(id);

      // Apply results even if the effect was re-run for a newer
      // `examples` array — discarding them would leave those ids
      // permanently missing from `urls`, and the effect would not
      // re-run for an unchanged `pendingKey`.
      if (!mountedRef.current) return;

      const nextUrls: Record<string, string> = {};
      const nextFailed = new Set<string>();
      results.forEach((result, index) => {
        const id = ids[index];
        if (result.status === "fulfilled") {
          nextUrls[id] = result.value;
        } else {
          nextFailed.add(id);
        }
      });

      if (Object.keys(nextUrls).length > 0) {
        setUrls((prev) => ({ ...prev, ...nextUrls }));
      }
      if (nextFailed.size > 0) {
        setFailedIds((prev) => new Set([...prev, ...nextFailed]));
      }
    })();
    // `ids` is derived from `pendingKey`; listing it directly would
    // re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, onboardingId]);

  const active = activeIndex !== null ? examples[activeIndex] : null;
  const activeUrl = active ? urls[active._id] : undefined;

  const closeLightbox = useCallback(() => setActiveIndex(null), []);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        setActiveIndex((current) =>
          current === null ? current : Math.min(current + 1, examples.length - 1)
        );
      }
      if (event.key === "ArrowLeft") {
        setActiveIndex((current) =>
          current === null ? current : Math.max(current - 1, 0)
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, examples.length]);

  const handleDownload = useCallback(
    async (example: WorkExampleGalleryItem) => {
      if (downloadingId) return;
      setDownloadingId(example._id as string);
      try {
        const url = await fetchSignedUrl(onboardingId, example._id as string, true);
        // A programmatic anchor click is the only cross-browser way to
        // download a cross-origin signed URL; the disposition header on
        // the URL does the actual "save as" work.
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.rel = "noopener";
        anchor.download = example.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } catch {
        toast.error(`Couldn't prepare ${example.fileName} for download.`);
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, onboardingId]
  );

  const handleExportAll = useCallback(async () => {
    if (createExport.isPending) return;
    try {
      const result = await createExport.mutateAsync({
        onboardingId: onboardingId as Id<"adminOnboardings">,
      });
      if (result.errorMessage) {
        toast.error(result.errorMessage);
      } else {
        toast.success("Building artwork ZIP — this usually takes a few seconds.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to start the artwork export."
      );
    }
  }, [createExport, onboardingId]);

  const exportStatus = latestExport?.status;
  const isExporting = exportStatus === "pending" || exportStatus === "processing";
  const exportExpired =
    exportStatus === "completed" && isExpired(latestExport?.expiresAt);

  const grid = useMemo(
    () =>
      examples.map((example, index) => {
        const url = urls[example._id];
        const failed = failedIds.has(example._id as string);
        return (
          <div
            key={example._id}
            className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
          >
            <button
              type="button"
              className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
              onClick={() => setActiveIndex(index)}
              aria-label={`View ${example.fileName} at full size`}
              disabled={!url}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={example.fileName}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {failed ? (
                    <span className="px-1 text-center text-[10px] text-destructive">
                      preview unavailable
                    </span>
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
              )}
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-background/90 to-transparent px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <span className="line-clamp-1 text-xs">{example.fileName}</span>
              {url && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="pointer-events-auto h-7 w-7 shrink-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDownload(example);
                  }}
                  disabled={downloadingId === example._id}
                  aria-label={`Download ${example.fileName}`}
                  title={`Download ${example.fileName}`}
                >
                  {downloadingId === example._id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        );
      }),
    [examples, failedIds, handleDownload, downloadingId, urls]
  );

  if (examples.length === 0) return <></>;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Work examples{" "}
          <span className="font-normal text-muted-foreground">({examples.length})</span>
        </p>
        {canExportAll && (
          <div className="flex flex-wrap items-center gap-2">
            {isExporting ? (
              <>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Building ZIP…
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    latestExport &&
                    cancelExport.mutate({ id: latestExport._id })
                  }
                  disabled={cancelExport.isPending}
                  aria-label="Cancel export"
                >
                  {cancelExport.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </Button>
              </>
            ) : exportStatus === "completed" &&
              latestExport?.downloadUrl &&
              !exportExpired ? (
              <>
                <Button type="button" size="sm" variant="default" asChild>
                  <a href={latestExport.downloadUrl} download>
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Download all
                    {latestExport.fileCount ? ` (${latestExport.fileCount})` : ""}
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleExportAll}
                  disabled={createExport.isPending}
                >
                  Rebuild ZIP
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleExportAll}
                  disabled={createExport.isPending || exportsLoading}
                >
                  {createExport.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  Download all (ZIP)
                </Button>
                {exportExpired && (
                  <span className="text-xs text-muted-foreground">
                    Previous ZIP expired
                  </span>
                )}
                {exportStatus === "failed" && latestExport?.errorMessage && (
                  <span
                    className="max-w-[18rem] truncate text-xs text-destructive"
                    title={latestExport.errorMessage}
                  >
                    Export failed: {latestExport.errorMessage}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{grid}</div>

      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) closeLightbox();
        }}
      >
        <DialogContent className="h-screen w-screen max-h-screen max-w-[100vw] gap-0 rounded-none border-none bg-black/95 p-0 [&>button]:hidden">
          <DialogTitle className="sr-only">
            {active ? `${active.fileName} preview` : "Artwork preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Full-size preview of the uploaded artwork. Use the arrow keys to move
            between images.
          </DialogDescription>
          {active && (
            <div className="flex h-full w-full flex-col p-4">
              <div className="flex items-center justify-between gap-3 pb-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{active.fileName}</p>
                  {formatBytes(active.size) && (
                    <p className="text-xs text-white/60">{formatBytes(active.size)}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleDownload(active)}
                    disabled={downloadingId === active._id}
                  >
                    {downloadingId === active._id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1 h-3.5 w-3.5" />
                    )}
                    Download
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-white hover:bg-white/20"
                    onClick={closeLightbox}
                    aria-label="Close preview"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="relative flex flex-1 items-center justify-center">
                {examples.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute left-0 z-10 text-white hover:bg-white/20"
                    onClick={() => setActiveIndex(Math.max((activeIndex ?? 0) - 1, 0))}
                    disabled={(activeIndex ?? 0) === 0}
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                )}
                {activeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeUrl}
                    alt={active.fileName}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <Loader2 className="h-8 w-8 animate-spin text-white/70" />
                )}
                {examples.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-0 z-10 text-white hover:bg-white/20"
                    onClick={() =>
                      setActiveIndex(Math.min((activeIndex ?? 0) + 1, examples.length - 1))
                    }
                    disabled={(activeIndex ?? 0) === examples.length - 1}
                    aria-label="Next image"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
