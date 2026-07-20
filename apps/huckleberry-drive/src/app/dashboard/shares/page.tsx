"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Link2, Clock, XCircle, RotateCcw, Trash2, Copy, Check, AlertCircle } from "lucide-react";
import { listMyShares, revokeShare, extendShare } from "@/lib/api";
import type { HdShareLink, ShareExpiryDays } from "@/lib/api";

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

function buildShareUrl(token: string): string {
  const base = (typeof window !== "undefined" ? window.location.origin : "") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://drive.huckleberry.art";
  return `${base.replace(/\/+$/, "")}/shared/${token}`;
}

function useNow(tickMs: number = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

function StatusBadge({ share, now }: { share: HdShareLink; now: number }): React.ReactElement {
  if (share.revokedAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-slate-700 text-slate-400">
        <XCircle className="w-3 h-3" />
        Revoked
      </span>
    );
  }
  if (share.expiresAt === null) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-300">
        <Link2 className="w-3 h-3" />
        Active · no expiry
      </span>
    );
  }
  if (now === 0 || share.expiresAt <= now) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-300">
        <Clock className="w-3 h-3" />
        Expired
      </span>
    );
  }
  const days = Math.ceil((share.expiresAt - now) / (1000 * 60 * 60 * 24));
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-300">
      <Clock className="w-3 h-3" />
      Active · expires in {days} day{days === 1 ? "" : "s"}
    </span>
  );
}

interface RowProps {
  share: HdShareLink;
  now: number;
  onChanged: () => void;
}

function ShareRow({ share, now, onChanged }: RowProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isExtending, setIsExtending] = useState<ShareExpiryDays | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = buildShareUrl(share.token);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(`share-row-${share.id}`) as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [share.id, url]);

  const handleRevoke = useCallback(async () => {
    setIsRevoking(true);
    setError(null);
    try {
      await revokeShare(share.token);
      setConfirmRevoke(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setIsRevoking(false);
    }
  }, [share.token, onChanged]);

  const handleExtend = useCallback(async (days: ShareExpiryDays) => {
    setIsExtending(days);
    setError(null);
    try {
      await extendShare(share.token, days);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extend");
    } finally {
      setIsExtending(null);
    }
  }, [share.token, onChanged]);

  const isRevoked = !!share.revokedAt;
  const isExpired = share.expiresAt !== null && now > 0 && share.expiresAt <= now;
  const canExtend = !isRevoked && !isExpired;

  return (
    <tr className="hover:bg-slate-800/30 transition-colors">
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-slate-200 truncate max-w-xs">
          {share.uploadOriginalName || "(file deleted)"}
        </div>
        {share.label && (
          <div className="text-xs text-slate-500 italic mt-0.5">&ldquo;{share.label}&rdquo;</div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex gap-2 max-w-md">
          <input
            id={`share-row-${share.id}`}
            type="text"
            readOnly
            value={url}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 text-xs font-mono"
          />
          <button
            onClick={handleCopy}
            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs flex items-center gap-1"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <StatusBadge share={share} now={now} />
        {share.expiresAt && (
          <div className="text-xs text-slate-500 mt-1">
            {formatDate(share.expiresAt)}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top text-center text-slate-400 text-sm">
        {share.accessCount}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex justify-end gap-1">
          {canExtend && !confirmRevoke && (
            <ExtendMenu
              currentValue={share.expiresAt === null ? "never" : "extend30"}
              isExtending={isExtending}
              onExtend={handleExtend}
            />
          )}
          {!isRevoked && !confirmRevoke && (
            <button
              onClick={() => setConfirmRevoke(true)}
              className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-300 transition-colors"
              title="Revoke"
              aria-label="Revoke share"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {confirmRevoke && (
            <>
              <button
                onClick={handleRevoke}
                disabled={isRevoking}
                className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {isRevoking ? "Revoking..." : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmRevoke(false)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
              >
                Cancel
              </button>
            </>
          )}
        </div>
        {error && (
          <div className="mt-1 text-xs text-red-400 flex items-center gap-1 justify-end">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}

function ExtendMenu({
  currentValue,
  isExtending,
  onExtend,
}: {
  currentValue: "never" | "extend30";
  isExtending: ShareExpiryDays | null;
  onExtend: (days: ShareExpiryDays) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300 transition-colors"
        title="Extend"
        aria-label="Extend share"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-20 overflow-hidden">
            <button
              onClick={() => {
                setOpen(false);
                onExtend(30);
              }}
              disabled={isExtending !== null}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 text-slate-200 disabled:opacity-50 flex items-center gap-2"
            >
              {isExtending === 30 && <Loader2 className="w-3 h-3 animate-spin" />}
              +30 days
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onExtend(365);
              }}
              disabled={isExtending !== null}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 text-slate-200 disabled:opacity-50 flex items-center gap-2"
            >
              {isExtending === 365 && <Loader2 className="w-3 h-3 animate-spin" />}
              +1 year
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onExtend("never");
              }}
              disabled={isExtending !== null}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 text-slate-200 disabled:opacity-50"
            >
              {currentValue === "never" ? "Already no expiry" : "Set no expiry"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SharesPage(): React.ReactElement {
  const [shares, setShares] = useState<HdShareLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const fetchShares = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await listMyShares();
      setShares(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Shares</h1>
          <p className="text-slate-400 mt-1">
            Manage links you have shared with video editors.
          </p>
        </div>
        <button
          onClick={fetchShares}
          disabled={isLoading}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {!isLoading && shares.length === 0 && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <Link2 className="w-12 h-12 mx-auto mb-4 text-slate-500 opacity-50" />
          <p className="text-lg text-slate-300">No shares yet</p>
          <p className="text-sm text-slate-500 mt-1">
            Open any file from the Dashboard and click the Share button to create a link.
          </p>
        </div>
      )}

      {shares.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  File
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Link
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Accesses
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {shares.map((share) => (
                <ShareRow key={share.id} share={share} now={now} onChanged={fetchShares} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
