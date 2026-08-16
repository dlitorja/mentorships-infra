"use client";

import React, { useState, useCallback } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { Download, Loader2, AlertCircle } from "lucide-react";

interface SharedDownloadButtonProps {
  token: string;
  siteKey: string;
}

export function SharedDownloadButton({
  token,
  siteKey,
}: SharedDownloadButtonProps): React.ReactElement {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    if (!turnstileToken) {
      setError("Please complete the security challenge first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/shared/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ turnstileToken }),
      });

      if (response.status === 401) {
        setError("Security challenge failed. Please refresh and try again.");
        setTurnstileToken(null);
        return;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Download failed. Please try again.");
        setTurnstileToken(null);
        return;
      }

      const payload = (await response.json()) as {
        downloadUrl?: string;
      };
      if (payload.downloadUrl) {
        window.location.href = payload.downloadUrl;
        return;
      }

      setError("Download failed. Please try again.");
    } catch (err) {
      console.error("Download error:", err);
      setError("Download failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [turnstileToken, token]);

  return (
    <div className="space-y-3">
      <Turnstile
        siteKey={siteKey}
        onSuccess={setTurnstileToken}
        onError={() => {
          setTurnstileToken(null);
          setError("Security challenge failed. Please try again.");
        }}
        onExpire={() => {
          setTurnstileToken(null);
          setError("Security challenge expired. Please complete it again.");
        }}
        options={{
          action: "share-download",
          theme: "dark",
        }}
      />

      <button
        type="button"
        onClick={handleDownload}
        disabled={isLoading || !turnstileToken}
        className="w-full px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800/50 disabled:text-emerald-400/50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        aria-label="Download file"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Preparing download...
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Download
          </>
        )}
      </button>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
