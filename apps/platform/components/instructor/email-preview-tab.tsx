"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Mail } from "lucide-react";

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
  const previewRequestId = useRef(0);

  const loadPreview = useCallback(async () => {
    const requestId = ++previewRequestId.current;
    setIsLoading(true);
    setError(null);

    try {
      const body: { type: PreviewType; newScheduledAt?: number; reason?: string } = {
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

      const response = await fetch(
        `/api/instructor/sessions/${sessionId}/email-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (requestId !== previewRequestId.current) {
        return;
      }

      if (!response.ok) {
        let errorMessage = "Failed to load preview";
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (requestId === previewRequestId.current) {
        setPreview(data.preview);
      }
    } catch (e) {
      if (requestId === previewRequestId.current) {
        setError(e instanceof Error ? e.message : "Failed to load preview");
      }
    } finally {
      if (requestId === previewRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId, previewType, newScheduledAt, reason]);

  useEffect(() => {
    if (activeTab === "preview" && !preview) {
      loadPreview();
    }
  }, [activeTab, preview, loadPreview]);

  useEffect(() => {
    setActiveTab("action");
    setPreview(null);
    setError(null);
  }, [sessionId, previewType, newScheduledAt, reason]);

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "action" | "preview")}>
      <TabsList className="w-full">
        <TabsTrigger value="action" className="flex-1">Action</TabsTrigger>
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
          <div className="text-center py-8 text-destructive text-sm">
            {error}
          </div>
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