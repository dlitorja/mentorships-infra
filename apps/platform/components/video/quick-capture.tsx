"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Link as LinkIcon, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Id } from "@/convex/_generated/dataModel";
import { useVideoCallContext } from "@/lib/video/video-context";
import {
  useCreateWorkspaceNote,
  useCreateWorkspaceLink,
  useCreateWorkspaceImage,
} from "@/lib/queries/convex/use-workspaces";
import { useConvexAction } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { useQuickCaptureShortcut } from "@/lib/hooks/use-quick-capture-shortcut";
import {
  uploadImageForChat,
  MAX_CHAT_FILE_BYTES,
  type UploadError,
} from "@/lib/workspace-image-upload";
import { clsx } from "clsx";
import { toast } from "sonner";

type QuickCaptureMode = "note" | "link" | "image";

/**
 * Floating Cmd/Ctrl+K overlay that lets the workspace user capture
 * text, a link, or a pasted image WITHOUT leaving the live call.
 *
 * Every captured item is auto-tagged with the active `sessionId`
 * via `useVideoCallContext().session?.sessionId`. Outside of an
 * active call the modal does not open and the shortcut is a no-op
 * (the listener is gated on `enabled`).
 *
 * Mounted once at the top of `workspace-client-page.tsx` (inside
 * `<VideoCallProvider>`) so it is available across every tab and
 * survives workspace switches via the provider key.
 */
export default function QuickCapture() {
  const { session, workspaceId: ctxWorkspaceId } = useVideoCallContext();
  const activeSessionId = session?.sessionId ?? null;
  const callIsActive =
    !!activeSessionId &&
    (session?.status === "active" || session?.status === "joinable");
  // PR #4b: prefer `workspaceId` from the VideoCallContext (set by
  // the provider from `useCurrentOrUpcomingSessionForWorkspace`).
  // Falls back to null when no call is active.
  const workspaceId: Id<"workspaces"> | null = ctxWorkspaceId;

  const [open, setOpen] = useState(false);
  const toggleOpen = useCallback(() => setOpen((v) => !v), []);

  useQuickCaptureShortcut(callIsActive, toggleOpen);

  // Reset state every time the modal opens so we never show stale
  // content from a previous capture.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!callIsActive) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => setOpen(next)}
    >
      <DialogContent
        className="max-w-lg gap-0 p-0 overflow-hidden"
        // Stop the consumer's PiP-Escape from running first by
        // re-binding the listener above with capture:true.
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Quick capture</DialogTitle>
            <DialogDescription>
              Save a note, link, or pasted image to this call. Everything
              you capture here is tagged to the active session.
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpen(false)}
            aria-label="Close quick capture"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <QuickCaptureBody
          workspaceId={workspaceId}
          sessionId={activeSessionId!}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface QuickCaptureBodyProps {
  workspaceId: Id<"workspaces"> | null;
  sessionId: Id<"sessions">;
  onClose: () => void;
}

function QuickCaptureBody({
  workspaceId,
  sessionId,
  onClose,
}: QuickCaptureBodyProps) {
  const [mode, setMode] = useState<QuickCaptureMode>("note");

  const createNote = useCreateWorkspaceNote();
  const createLink = useCreateWorkspaceLink();
  const createImage = useCreateWorkspaceImage();
  const generateUploadUrl = useConvexAction(
    api.workspaceActions.generateWorkspaceImageUploadUrl
  );

  const isPending = useMemo(
    () =>
      createNote.isPending || createLink.isPending || createImage.isPending,
    [createNote, createLink, createImage]
  );

  return (
    <div className="px-4 pb-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as QuickCaptureMode)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="note" className="gap-2">
            <FileText className="h-4 w-4" />
            Note
          </TabsTrigger>
          <TabsTrigger value="link" className="gap-2">
            <LinkIcon className="h-4 w-4" />
            Link
          </TabsTrigger>
          <TabsTrigger value="image" className="gap-2">
            <ImageIcon className="h-4 w-4" />
            Image
          </TabsTrigger>
        </TabsList>

        <TabsContent value="note" className="mt-3">
          <NoteCaptureForm
            workspaceId={workspaceId}
            sessionId={sessionId}
            disabled={isPending}
            onClose={onClose}
            onSubmit={async ({ title, content }) => {
              if (!workspaceId) return;
              await createNote.mutateAsync({
                workspaceId,
                title: title.trim(),
                content: content.trim(),
                sessionId,
              });
              toast.success("Note saved to this call");
            }}
          />
        </TabsContent>

        <TabsContent value="link" className="mt-3">
          <LinkCaptureForm
            workspaceId={workspaceId}
            sessionId={sessionId}
            disabled={isPending}
            onClose={onClose}
            onSubmit={async ({ url, title }) => {
              if (!workspaceId) return;
              await createLink.mutateAsync({
                workspaceId,
                url,
                title: title?.trim() || undefined,
                sessionId,
              });
              toast.success("Link saved to this call");
            }}
          />
        </TabsContent>

        <TabsContent value="image" className="mt-3">
          <ImageCaptureForm
            workspaceId={workspaceId}
            sessionId={sessionId}
            disabled={isPending}
            onClose={onClose}
            uploadImage={async (file) => {
              const result = await uploadImageForChat(
                workspaceId as Id<"workspaces">,
                file,
                generateUploadUrl
              );
              if (!result.success) {
                throw new Error(
                  (result as UploadError).error || "Upload failed"
                );
              }
              await createImage.mutateAsync({
                workspaceId: workspaceId as Id<"workspaces">,
                storageId: result.storageId,
                imageUrl: "",
                sessionId,
              });
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NoteCaptureForm({
  workspaceId,
  sessionId,
  disabled,
  onClose,
  onSubmit,
}: {
  workspaceId: Id<"workspaces"> | null;
  sessionId: Id<"sessions">;
  disabled: boolean;
  onClose: () => void;
  onSubmit: (values: { title: string; content: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!workspaceId || !content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim() || content.slice(0, 60).trim() || "Untitled",
        content,
      });
      setTitle("");
      setContent("");
      onClose();
    } catch (err) {
      console.error("Quick capture note failed", err);
      toast.error("Failed to save note");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={disabled || submitting}
        maxLength={200}
      />
      <Textarea
        autoFocus
        placeholder="Capture a quick note from the call…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        disabled={disabled || submitting}
        rows={4}
        className="resize-none"
      />
      <p className="text-xs text-muted-foreground">
        ⌘/Ctrl + Enter to save · Tags to session{" "}
        <code className="text-[10px]">{sessionId.slice(0, 6)}…</code>
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!content.trim() || disabled || submitting}
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function LinkCaptureForm({
  workspaceId,
  sessionId,
  disabled,
  onClose,
  onSubmit,
}: {
  workspaceId: Id<"workspaces"> | null;
  sessionId: Id<"sessions">;
  disabled: boolean;
  onClose: () => void;
  onSubmit: (values: { url: string; title?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!workspaceId || !url.trim()) return;
    const normalized = normalizeUrl(url.trim());
    if (!isValidUrl(normalized)) {
      toast.error("Please enter a valid URL (https://…)");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ url: normalized, title: title.trim() });
      setUrl("");
      setTitle("");
      onClose();
    } catch (err) {
      console.error("Quick capture link failed", err);
      toast.error("Failed to save link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={disabled || submitting}
      />
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={disabled || submitting}
      />
      <p className="text-xs text-muted-foreground">
        Tags to session <code className="text-[10px]">{sessionId.slice(0, 6)}…</code>
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!url.trim() || disabled || submitting}
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function ImageCaptureForm({
  workspaceId,
  sessionId,
  disabled,
  onClose,
  uploadImage,
}: {
  workspaceId: Id<"workspaces"> | null;
  sessionId: Id<"sessions">;
  disabled: boolean;
  onClose: () => void;
  uploadImage: (file: File) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!workspaceId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported");
      return;
    }
    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error("Image is too large. Maximum size is 50MB.");
      return;
    }
    setSubmitting(true);
    try {
      await uploadImage(file);
      setPreview(null);
      onClose();
    } catch (err) {
      console.error("Quick capture image failed", err);
      toast.error("Failed to save image");
    } finally {
      setSubmitting(false);
    }
  };

  // Paste-from-clipboard while this tab is active.
  //
  // PR #4b (Greptile R1 P1): the Images tab installs its own
  // `window` paste listener while a call is active. Without
  // coordination, both listeners would receive the same event and
  // upload the image twice. We bind with `capture: true` and call
  // `stopImmediatePropagation()` so the Quick Capture handler wins
  // when the dialog is open (it is the visible, focused surface for
  // the capture). The Images tab listener still fires for pastes
  // while the Quick Capture dialog is closed.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (submitting || disabled) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const reader = new FileReader();
      reader.onload = (ev) => setPreview((ev.target?.result as string) ?? null);
      reader.readAsDataURL(file);
      void handleFile(file);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, disabled, workspaceId]);

  return (
    <div className="space-y-2">
      <div
        className={clsx(
          "rounded-md border-2 border-dashed p-4 text-center text-sm text-muted-foreground",
          submitting && "opacity-60"
        )}
      >
        {submitting ? (
          <p>Uploading…</p>
        ) : (
          <p>
            Paste an image (⌘/Ctrl + V) to save it to this call. Tags to session{" "}
            <code className="text-[10px]">{sessionId.slice(0, 6)}…</code>
          </p>
        )}
      </div>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Paste preview"
          className="rounded-md border max-h-48 mx-auto"
        />
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
