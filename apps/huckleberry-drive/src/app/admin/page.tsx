"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { DollarSign, Loader2, RefreshCw } from "lucide-react";
import { getAdminStats } from "@/lib/api";
import type { AdminStats } from "@/lib/api";

export default function AdminPage(): React.ReactElement {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminLinks = [
    {
      href: "/admin/costs",
      label: "Storage Costs",
      description: "View monthly storage costs and usage breakdown",
      icon: <DollarSign className="w-6 h-6" />,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      href: "/admin/storage/sync",
      label: "Storage Sync",
      description: "Monitor bucket contents and sync with database",
      icon: <RefreshCw className="w-6 h-6" />,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
  ];

  useEffect(() => {
    async function fetchStats() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getAdminStats();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setIsLoading(false);
      }
    }

    fetchStats();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    return `${value} ${sizes[i]}`;
  };

  const B2_COST_PER_GB_PER_MONTH = 0.006;

  const estimateMonthlyCost = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    const cost = gb * B2_COST_PER_GB_PER_MONTH;
    return `$${cost.toFixed(2)}`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Admin Panel</h1>
        <p className="text-slate-400 mt-1">Manage Huckleberry Drive settings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group p-6 bg-slate-800/30 border border-slate-700 rounded-xl hover:border-slate-600 hover:bg-slate-800/50 transition-all"
          >
            <div
              className={`w-12 h-12 ${link.bgColor} rounded-lg ${link.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
            >
              {link.icon}
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-1">
              {link.label}
            </h3>
            <p className="text-sm text-slate-400">{link.description}</p>
          </Link>
        ))}
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Quick Stats</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            <span className="ml-2 text-slate-400">Loading stats...</span>
          </div>
        ) : error ? (
          <div className="text-red-400 text-sm">{error}</div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-bold text-emerald-400">{stats.totalInstructors}</p>
              <p className="text-sm text-slate-400">Total Instructors</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">{stats.totalFiles.toLocaleString()}</p>
              <p className="text-sm text-slate-400">Total Files</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">{formatBytes(stats.totalBytes)}</p>
              <p className="text-sm text-slate-400">Storage Used</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">
                {estimateMonthlyCost(stats.totalBytes)}
              </p>
              <p className="text-sm text-slate-400">Est. Monthly Cost</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-bold text-emerald-400">-</p>
              <p className="text-sm text-slate-400">Total Instructors</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">-</p>
              <p className="text-sm text-slate-400">Total Files</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">-</p>
              <p className="text-sm text-slate-400">Storage Used</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">-</p>
              <p className="text-sm text-slate-400">Est. Monthly Cost</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}