"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Mail, X, UserPlus, AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { listHdInvitations, createHdInvitation, cancelHdInvitation } from "@/lib/api";
import type { HdInvitation, InvitationListResponse, UserRole } from "@/lib/api";

const ROLE_LABELS: Record<UserRole, string> = {
  student: "Student",
  instructor: "Instructor",
  admin: "Admin",
  video_editor: "Video Editor",
};

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, color: "text-amber-400 bg-amber-400/10", label: "Pending" },
  accepted: { icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-400 bg-emerald-400/10", label: "Accepted" },
  expired: { icon: <Clock className="w-4 h-4" />, color: "text-slate-400 bg-slate-400/10", label: "Expired" },
  cancelled: { icon: <XCircle className="w-4 h-4" />, color: "text-red-400 bg-red-400/10", label: "Cancelled" },
};

export default function AdminInvitationsPage(): React.ReactElement {
  const [invitations, setInvitations] = useState<HdInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<UserRole>("student");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showConfirmCancel, setShowConfirmCancel] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result: InvitationListResponse = await listHdInvitations();
      setInvitations(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invitations");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleSendInvitation = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedEmail = emailInput.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Email is required");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    try {
      setIsSending(true);
      setError(null);
      await createHdInvitation(trimmedEmail, roleInput);
      setEmailInput("");
      setSuccessMessage(`Invitation sent to ${trimmedEmail} as ${ROLE_LABELS[roleInput]}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setIsSending(false);
    }
  }, [emailInput, roleInput, fetchInvitations]);

  const handleCancelInvitation = useCallback(async (invitationId: string) => {
    try {
      setIsCancelling(invitationId);
      await cancelHdInvitation(invitationId);
      setShowConfirmCancel(null);
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel invitation");
    } finally {
      setIsCancelling(null);
    }
  }, [fetchInvitations]);

  const filteredInvitations = statusFilter === "all"
    ? invitations
    : invitations.filter((inv) => inv.status === statusFilter);

  const stats = {
    total: invitations.length,
    pending: invitations.filter((i) => i.status === "pending").length,
    accepted: invitations.filter((i) => i.status === "accepted").length,
    expired: invitations.filter((i) => i.status === "expired").length,
    cancelled: invitations.filter((i) => i.status === "cancelled").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Invitations</h1>
        <p className="text-slate-400 mt-1">Send invitations to invite users to Huckleberry Drive</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Send New Invitation</h2>
            <p className="text-sm text-slate-400">Enter email address and select user role</p>
          </div>
        </div>

        <form onSubmit={handleSendInvitation} className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[280px]">
            <label htmlFor="email" className="block text-sm font-medium text-slate-400 mb-1.5">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="invitee@example.com"
              disabled={isSending}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            />
          </div>

          <div className="w-48">
            <label htmlFor="role" className="block text-sm font-medium text-slate-400 mb-1.5">
              User Role
            </label>
            <select
              id="role"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value as UserRole)}
              disabled={isSending}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="student">Student</option>
              <option value="instructor">Instructor</option>
              <option value="admin">Admin</option>
              <option value="video_editor">Video Editor</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isSending}
            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                Send Invitation
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {successMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <button
          onClick={() => setStatusFilter("all")}
          className={`p-4 rounded-xl border transition-all ${
            statusFilter === "all"
              ? "bg-slate-700 border-emerald-500/50"
              : "bg-slate-800/30 border-slate-700 hover:border-slate-600"
          }`}
        >
          <p className="text-2xl font-bold text-slate-200">{stats.total}</p>
          <p className="text-sm text-slate-400">Total</p>
        </button>
        <button
          onClick={() => setStatusFilter("pending")}
          className={`p-4 rounded-xl border transition-all ${
            statusFilter === "pending"
              ? "bg-slate-700 border-amber-500/50"
              : "bg-slate-800/30 border-slate-700 hover:border-slate-600"
          }`}
        >
          <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
          <p className="text-sm text-slate-400">Pending</p>
        </button>
        <button
          onClick={() => setStatusFilter("accepted")}
          className={`p-4 rounded-xl border transition-all ${
            statusFilter === "accepted"
              ? "bg-slate-700 border-emerald-500/50"
              : "bg-slate-800/30 border-slate-700 hover:border-slate-600"
          }`}
        >
          <p className="text-2xl font-bold text-emerald-400">{stats.accepted}</p>
          <p className="text-sm text-slate-400">Accepted</p>
        </button>
        <button
          onClick={() => setStatusFilter("expired")}
          className={`p-4 rounded-xl border transition-all ${
            statusFilter === "expired"
              ? "bg-slate-700 border-slate-500/50"
              : "bg-slate-800/30 border-slate-700 hover:border-slate-600"
          }`}
        >
          <p className="text-2xl font-bold text-slate-400">{stats.expired}</p>
          <p className="text-sm text-slate-400">Expired</p>
        </button>
        <button
          onClick={() => setStatusFilter("cancelled")}
          className={`p-4 rounded-xl border transition-all ${
            statusFilter === "cancelled"
              ? "bg-slate-700 border-red-500/50"
              : "bg-slate-800/30 border-slate-700 hover:border-slate-600"
          }`}
        >
          <p className="text-2xl font-bold text-red-400">{stats.cancelled}</p>
          <p className="text-sm text-slate-400">Cancelled</p>
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 border-b-2 border-emerald-500 mx-auto animate-spin" />
            <p className="mt-4 text-slate-400">Loading invitations...</p>
          </div>
        </div>
      ) : error && invitations.length === 0 ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <p className="text-red-400">{error}</p>
          <button
            onClick={fetchInvitations}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : filteredInvitations.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">
            {statusFilter === "all" ? "No invitations yet" : `No ${statusFilter} invitations`}
          </p>
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="mt-2 text-sm text-emerald-400 hover:text-emerald-300"
            >
              View all invitations
            </button>
          )}
        </div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Sent
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Expires
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredInvitations.map((invitation) => {
                const statusConfig = STATUS_CONFIG[invitation.status] || STATUS_CONFIG.pending;
                return (
                  <tr
                    key={invitation.id}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-200">{invitation.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-300">{ROLE_LABELS[invitation.role]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
                        {statusConfig.icon}
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm">
                      {formatDate(invitation.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm">
                      {formatDate(invitation.expiresAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {invitation.status === "pending" && (
                          <>
                            {showConfirmCancel === invitation.id ? (
                              <>
                                <button
                                  onClick={() => handleCancelInvitation(invitation.id)}
                                  disabled={isCancelling === invitation.id}
                                  className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                                >
                                  {isCancelling === invitation.id ? "Cancelling..." : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setShowConfirmCancel(null)}
                                  className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setShowConfirmCancel(invitation.id)}
                                disabled={isCancelling !== null}
                                className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                                title="Cancel Invitation"
                                aria-label="Cancel Invitation"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}