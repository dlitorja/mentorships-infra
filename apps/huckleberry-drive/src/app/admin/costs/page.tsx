"use client";

import React, { useState, useEffect } from "react";
import { CostChart } from "@/components/cost-chart";
import { getCosts } from "@/lib/api";
import type { CostData } from "@/lib/api";

export default function CostsPage(): React.ReactElement {
  const [costs, setCosts] = useState<CostData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCosts() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getCosts();
        setCosts([data.currentMonth, ...data.historical]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load costs");
      } finally {
        setIsLoading(false);
      }
    }

    fetchCosts();
  }, []);

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
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Storage Costs</h1>
        <p className="text-slate-400 mt-1">Monthly storage cost breakdown</p>
      </div>

      <CostChart costs={costs} />

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Cost Breakdown</h2>
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
                  <td className="px-4 py-3 text-right text-slate-400">${(cost.b2StorageCost / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">${(cost.b2DownloadCost / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">${(cost.b2ApiCost / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">${(cost.s3StorageCost / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">${(cost.s3RetrievalCost / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-400">${(cost.totalCost / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}