"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Copy, Check, Loader2, X } from "lucide-react";

interface ShareDialogProps {
  uploadId: string;
  originalName: string;
  open: boolean;
  onClose: () => void;
}

type ExpiryChoice = 7 | 30 | "never";

export function ShareDialog({ uploadId, originalName, open, onClose }: ShareDialogProps): React.ReactElement | null {
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>(30);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel("");
      setExpiry(30);
      setShareUrl(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          label: label.trim() || undefined,
          expiresInDays: expiry === "never" ? "never" : expiry,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create share" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setShareUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setIsCreating(false);
    }
  }, [uploadId, label, expiry]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById("share-url-input") as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [shareUrl]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={handleBackdropClick}
    >
      <div className="relative max-w-lg w-full mx-4 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white"
          aria-label="Close share dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-100">Share file</h2>
          <p className="mt-1 text-sm text-slate-400 truncate">{originalName}</p>

          {shareUrl ? (
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Anyone with this link who is signed in as a video editor can view and download this file.
                </label>
                <div className="flex gap-2">
                  <input
                    id="share-url-input"
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Manage or revoke this link from the Shares page.
              </p>
              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="share-label" className="block text-sm font-medium text-slate-300 mb-2">
                  Label (optional)
                </label>
                <input
                  id="share-label"
                  type="text"
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. for Bob re: scene 3"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Link expiry
                </label>
                <div className="flex gap-2">
                  <ExpiryRadio
                    value={7}
                    current={expiry}
                    onChange={(v) => setExpiry(v)}
                    label="7 days"
                  />
                  <ExpiryRadio
                    value={30}
                    current={expiry}
                    onChange={(v) => setExpiry(v)}
                    label="30 days"
                    recommended
                  />
                  <ExpiryRadio
                    value="never"
                    current={expiry}
                    onChange={(v) => setExpiry(v)}
                    label="No expiry"
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Anyone signed in as a video editor can open the link. You can revoke it at any time.
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create share link
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpiryRadio({
  value,
  current,
  onChange,
  label,
  recommended,
}: {
  value: ExpiryChoice;
  current: ExpiryChoice;
  onChange: (v: ExpiryChoice) => void;
  label: string;
  recommended?: boolean;
}): React.ReactElement {
  const isSelected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
        isSelected
          ? "bg-emerald-600 border-emerald-500 text-white"
          : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
      }`}
    >
      {label}
      {recommended && (
        <span className="ml-1 text-xs opacity-75">(recommended)</span>
      )}
    </button>
  );
}
