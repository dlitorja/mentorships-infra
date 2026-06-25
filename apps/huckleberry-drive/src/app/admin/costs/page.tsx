"use client";

import React, { useState, useEffect } from "react";
import { CostChart } from "@/components/cost-chart";
import { getCosts } from "@/lib/api";
import type { CostData } from "@/lib/api";
import { DollarSign, Database, Download, Cloud, AlertTriangle, RefreshCw } from "lucide-react";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subValue?: string;
  alert?: boolean;
}

function SummaryCard({ title, value, icon, subValue, alert }: SummaryCardProps) {
  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          alert ? "bg-red-500/10 text-red-400" : "bg-purple-500/10 text-purple-400"
        }`}>
          {icon}
        </div>
        <span className="text-sm font-medium text-slate-400">{title}</span>
      </div>
      <p className={`text-2xl font-bold ${alert ? "text-red-400" : "text-emerald-400"}`}>
        {value}
      </p>
      {subValue && (
        <p className="text-xs text-slate-500 mt-1">{subValue}</p>
      )}
    </div>
  );
}

export default function CostsPage(): React.ReactElement {
  const [costs, setCosts] = useState<CostData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchCosts = async () => {
    try {
      setError(null);
      const data = await getCosts();
      setCosts([data.currentMonth, ...data.historical]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load costs");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCosts();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCosts();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto" />
          <p className="mt-4 text-slate-400">Loading cost data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Storage Costs</h1>
          <p className="text-slate-400 mt-1">Monthly storage cost breakdown</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentMonthData = costs[0];
  const hasData = currentMonthData && (
    currentMonthData.b2StorageCost > 0 ||
    currentMonthData.b2DownloadCost > 0 ||
    currentMonthData.b2ApiCost > 0 ||
    currentMonthData.s3StorageCost > 0 ||
    currentMonthData.s3RetrievalCost > 0
  );
  const isPlaceholder = !hasData;

  const b2StorageOnly = currentMonthData?.b2StorageCost ?? 0;
  const b2DownloadsAndApi = (currentMonthData?.b2DownloadCost ?? 0) +
    (currentMonthData?.b2ApiCost ?? 0);
  const s3StorageOnly = currentMonthData?.s3StorageCost ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Storage Costs</h1>
          <p className="text-slate-400 mt-1">Monthly storage cost breakdown</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isPlaceholder && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-400 font-medium">Cost data not yet available</p>
            <p className="text-amber-200/70 text-sm mt-1">
              Historical cost data is still being migrated. Showing placeholder values of $0.00.
              Once billing integration is configured, actual costs will be displayed.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total This Month"
          value={formatCost(currentMonthData?.totalCost ?? 0)}
          icon={<DollarSign className="w-5 h-5" />}
          subValue={currentMonthData?.month ?? ""}
        />
        <SummaryCard
          title="B2 Cloud Storage"
          value={formatCost(b2StorageOnly)}
          icon={<Cloud className="w-5 h-5" />}
        />
        <SummaryCard
          title="B2 Downloads & API"
          value={formatCost(b2DownloadsAndApi)}
          icon={<Download className="w-5 h-5" />}
          subValue={`Downloads: ${formatCost(currentMonthData?.b2DownloadCost ?? 0)} | API: ${formatCost(currentMonthData?.b2ApiCost ?? 0)}`}
        />
        <SummaryCard
          title="S3 Storage"
          value={formatCost(s3StorageOnly)}
          icon={<Database className="w-5 h-5" />}
        />
      </div>

      <CostChart costs={costs} />

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Cost Breakdown</h2>
        {costs.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <p>No cost data available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">B2 Storage</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">B2 Downloads</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">B2 API</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">S3 Storage</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">S3 Retrieval</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {costs.map((cost) => (
                  <tr key={cost.month}>
                    <td className="px-4 py-3 text-slate-200">{cost.month}</td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {cost.b2StorageCost > 0 ? formatCost(cost.b2StorageCost) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {cost.b2DownloadCost > 0 ? formatCost(cost.b2DownloadCost) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {cost.b2ApiCost > 0 ? formatCost(cost.b2ApiCost) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {cost.s3StorageCost > 0 ? formatCost(cost.s3StorageCost) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {cost.s3RetrievalCost > 0 ? formatCost(cost.s3RetrievalCost) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-400">
                      {cost.totalCost > 0 ? formatCost(cost.totalCost) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}