"use client";

import { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Mail } from "lucide-react";
import { previewSessionEmail } from "@/lib/queries/api-client";

type PreviewType = "reschedule" | "cancel";

type EmailPreview = {
  subject: string;
  html: string;
};

type EmailPreviewTabProps = {
  sessionId: string;
  previewType: PreviewType;
  newScheduledAt?: number;
  reason?: string;
  actionContent: React.ReactNode;
};

/**
 * Tabbed component showing an action form and an email preview for session changes.
 * Used inside reschedule and cancel dialogs to let instructors preview the email
 * that will be sent to the student before confirming.
 *
 * @param sessionId - ID of the session to preview
 * @param previewType - Either "reschedule" or "cancel"
 * @param newScheduledAt - New scheduled time (required for reschedule preview)
 * @param reason - Cancellation reason (optional, for cancel preview)
 * @param actionContent - React node for the action tab content
 */
export function EmailPreviewTab({
  sessionId,
  previewType,
  newScheduledAt,
  reason,
  actionContent,
}: EmailPreviewTabProps) {
  const [activeTab, setActiveTab] = useState<"action" | "preview">("action");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset state whenever the preview inputs change. This is combined with the
    // fetch effect so reset + fetch cannot interleave when the user toggles tabs
    // or changes fields rapidly.
    setActiveTab("action");
    setPreview(null);
    setError(null);

    // Cancel any in-flight request for the previous inputs.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [sessionId, previewType, newScheduledAt, reason]);

  useEffect(() => {
    if (activeTab !== "preview") {
      return;
    }

    // If the user switches back to action while a preview is loading, abort it.
    const controller = new AbortController();
    abortControllerRef.current = controller;

    async function loadPreview() {
      setIsLoading(true);
      setError(null);

      try {
        const body: {
          type: PreviewType;
          newScheduledAt?: number;
          reason?: string;
        } = {
          type: previewType,
        };

        if (previewType === "reschedule" && newScheduledAt) {
          body.newScheduledAt = newScheduledAt;
        }

        if (previewType === "cancel") {
          const trimmedReason = reason?.trim();
          if (trimmedReason) {
            body.reason = trimmedReason;
          }
        }

        const data = await previewSessionEmail(sessionId, body, controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setPreview(data.preview);
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        if (e instanceof Error && e.name === "AbortError") {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load preview");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      controller.abort();
    };
  }, [activeTab, previewType, newScheduledAt, reason, sessionId]);

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "action" | "preview")}>
      <TabsList className="w-full">
        <TabsTrigger value="action" className="flex-1">
          Action
        </TabsTrigger>
        <TabsTrigger value="preview" className="flex-1">
          <Mail className="h-4 w-4 mr-1.5" />
          Preview
        </TabsTrigger>
      </TabsList>
      <TabsContent value="action" className="mt-4">
        {actionContent}
      </TabsContent>
      <TabsContent value="preview" className="mt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            Loading preview...
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive text-sm">{error}</div>
        ) : preview ? (
          <div className="space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted px-4 py-2 border-b">
                <p className="text-xs font-medium text-muted-foreground mb-1">Subject:</p>
                <p className="text-sm font-medium">{preview.subject}</p>
              </div>
              <div
                className="p-4 text-sm [&_a]:text-blue-600 [&_a]:underline [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mb-3 [&_p]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            </div>
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
