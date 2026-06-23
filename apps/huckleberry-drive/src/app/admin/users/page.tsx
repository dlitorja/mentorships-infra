"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Loader2,
  Trash2,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Users,
  UserX,
} from "lucide-react";
import {
  getAdminUsers,
  updateUserRole,
  softDeleteUser,
  restoreUser,
  hardDeleteUser,
  type AdminUser,
  type DeletedUser,
  type UserRole,
} from "@/lib/api";

const ROLE_LABELS: Record<UserRole, string> = {
  student: "Student",
  instructor: "Instructor",
  admin: "Admin",
  video_editor: "Video Editor",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminUsersPage(): React.ReactElement {
  const [activeUsers, setActiveUsers] = useState<AdminUser[]>([]);
  const [deletedUsers, setDeletedUsers] = useState<DeletedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"active" | "deleted">("active");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [showSoftDeleteConfirm, setShowSoftDeleteConfirm] = useState<string | null>(null);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  const { user } = useUser();
  const currentUserId = user?.id ?? null;

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAdminUsers();
      setActiveUsers(result.active);
      setDeletedUsers(result.deleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = useCallback(async (userId: string, newRole: UserRole) => {
    try {
      setIsProcessing(userId);
      setError(null);
      await updateUserRole(userId, newRole);
      setSuccessMessage("Role updated successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setIsProcessing(null);
    }
  }, [fetchUsers]);

  const handleSoftDelete = useCallback(async (userId: string) => {
    try {
      setIsProcessing(userId);
      setError(null);
      await softDeleteUser(userId);
      setShowSoftDeleteConfirm(null);
      setSuccessMessage("User soft-deleted successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setIsProcessing(null);
    }
  }, [fetchUsers]);

  const handleRestore = useCallback(async (userId: string) => {
    try {
      setIsProcessing(userId);
      setError(null);
      await restoreUser(userId);
      setShowRestoreConfirm(null);
      setSuccessMessage("User restored successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore user");
    } finally {
      setIsProcessing(null);
    }
  }, [fetchUsers]);

  const handleHardDelete = useCallback(async (userId: string) => {
    try {
      setIsProcessing(userId);
      setError(null);
      await hardDeleteUser(userId);
      setShowHardDeleteConfirm(null);
      setSuccessMessage("User hard-deleted. File cleanup queued.");
      setTimeout(() => setSuccessMessage(null), 5000);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setIsProcessing(null);
    }
  }, [fetchUsers]);

  const displayedUsers = activeTab === "active" ? activeUsers : deletedUsers;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">User Management</h1>
        <p className="text-slate-400 mt-1">Manage user accounts and permissions</p>
      </div>

      <div className="flex gap-4 border-b border-slate-700">
        <button
          onClick={() => setActiveTab("active")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === "active"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          <Users className="w-4 h-4" />
          Active Users
          <span className="ml-1 px-2 py-0.5 bg-slate-700 rounded-full text-xs">
            {activeUsers.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("deleted")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === "deleted"
              ? "border-red-500 text-red-400"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          <UserX className="w-4 h-4" />
          Deleted Users
          <span className="ml-1 px-2 py-0.5 bg-slate-700 rounded-full text-xs">
            {deletedUsers.length}
          </span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-sm hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 border-b-2 border-emerald-500 mx-auto animate-spin" />
            <p className="mt-4 text-slate-400">Loading users...</p>
          </div>
        </div>
      ) : displayedUsers.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">
            {activeTab === "active" ? "No active users" : "No deleted users"}
          </p>
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
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {activeTab === "active" ? "Joined" : "Deleted"}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {displayedUsers.map((user) => {
                const isProcessingThis = isProcessing === user.userId;

                return (
                  <tr
                    key={user.userId}
                    className="hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-200">{user.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-300">
                        {[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {activeTab === "active" ? (
                        <select
                          value={user.role ?? "student"}
                          onChange={(e) => handleRoleChange(user.userId, e.target.value as UserRole)}
                          disabled={isProcessingThis || user.userId === currentUserId}
                          className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                        >
                          <option value="student">Student</option>
                          <option value="instructor">Instructor</option>
                          <option value="admin">Admin</option>
                          <option value="video_editor">Video Editor</option>
                        </select>
                      ) : (
                        <span className="text-slate-300">{ROLE_LABELS[user.role ?? "student"]}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-sm">
                      {activeTab === "active"
                        ? formatDate(user.createdAt)
                        : formatDate((user as DeletedUser).deletedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {activeTab === "active" ? (
                          <>
                            {showSoftDeleteConfirm === user.userId ? (
                              <>
                                <button
                                  onClick={() => handleSoftDelete(user.userId)}
                                  disabled={isProcessingThis}
                                  className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                                >
                                  {isProcessingThis ? "Deleting..." : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setShowSoftDeleteConfirm(null)}
                                  className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setShowSoftDeleteConfirm(user.userId)}
                                disabled={isProcessing !== null || user.userId === currentUserId}
                                className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                                title="Soft Delete User"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            {showRestoreConfirm === user.userId ? (
                              <>
                                <button
                                  onClick={() => handleRestore(user.userId)}
                                  disabled={isProcessingThis}
                                  className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {isProcessingThis ? "Restoring..." : "Confirm Restore"}
                                </button>
                                <button
                                  onClick={() => setShowRestoreConfirm(null)}
                                  className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : showHardDeleteConfirm === user.userId ? (
                              <>
                                <button
                                  onClick={() => handleHardDelete(user.userId)}
                                  disabled={isProcessingThis}
                                  className="px-3 py-1.5 text-xs font-medium bg-red-700 text-white rounded-md hover:bg-red-800 disabled:opacity-50"
                                >
                                  {isProcessingThis ? "Deleting..." : "Hard Delete"}
                                </button>
                                <button
                                  onClick={() => setShowHardDeleteConfirm(null)}
                                  className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setShowRestoreConfirm(user.userId)}
                                  disabled={isProcessing !== null}
                                  className="p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                                  title="Restore User"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setShowHardDeleteConfirm(user.userId)}
                                  disabled={isProcessing !== null}
                                  className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                                  title="Hard Delete User and Files"
                                >
                                  <AlertTriangle className="w-4 h-4" />
                                </button>
                              </>
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

      {(showSoftDeleteConfirm || showHardDeleteConfirm || showRestoreConfirm) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              {showSoftDeleteConfirm && (
                <>
                  <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-200">Soft Delete User</h2>
                    <p className="text-sm text-slate-400">This action can be undone</p>
                  </div>
                </>
              )}
              {showHardDeleteConfirm && (
                <>
                  <div className="w-10 h-10 bg-red-700/10 rounded-lg flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-200">Hard Delete User</h2>
                    <p className="text-sm text-red-400">Permanent action - cannot be undone</p>
                  </div>
                </>
              )}
              {showRestoreConfirm && (
                <>
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <RotateCcw className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-200">Restore User</h2>
                    <p className="text-sm text-slate-400">User will be able to login again</p>
                  </div>
                </>
              )}
            </div>

            <p className="text-slate-300 mb-4">
              {showSoftDeleteConfirm && "The user will be prevented from logging in and all pending invitations will be cancelled. Their files will remain accessible to admins."}
              {showHardDeleteConfirm && "This will permanently delete the user and all their B2 files. This action cannot be undone."}
              {showRestoreConfirm && "The user will be able to log in again. A new Clerk invitation will be created if needed."}
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSoftDeleteConfirm(null);
                  setShowHardDeleteConfirm(null);
                  setShowRestoreConfirm(null);
                }}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}