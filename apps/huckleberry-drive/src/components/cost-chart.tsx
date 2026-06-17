"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { DollarSign } from "lucide-react";
import type { CostData } from "@/lib/api";

interface CostChartProps {
  costs: CostData[];
}

export function CostChart({ costs }: CostChartProps): React.ReactElement {
  const formatMonth = (month: string): string => {
    const [year, monthNum] = month.split("-");
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const data = costs.map((cost) => ({
    month: formatMonth(cost.month),
    "B2 Storage": cost.b2StorageCost / 100,
    "B2 Downloads": cost.b2DownloadCost / 100,
    "B2 API": cost.b2ApiCost / 100,
    "S3 Storage": cost.s3StorageCost / 100,
    "S3 Retrieval": cost.s3RetrievalCost / 100,
    total: cost.totalCost / 100,
  }));

  if (data.length === 0) {
    return (
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <DollarSign className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold text-slate-200">Monthly Costs</h3>
        </div>
        <div className="text-center py-12 text-slate-500">
          <p>No cost data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <DollarSign className="w-5 h-5 text-purple-500" />
        <h3 className="font-semibold text-slate-200">Monthly Costs</h3>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              axisLine={{ stroke: "#334155" }}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              axisLine={{ stroke: "#334155" }}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#e2e8f0",
              }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
            />
            <Legend
              wrapperStyle={{ paddingTop: "20px" }}
              iconType="circle"
              iconSize={8}
            />
            <Bar
              dataKey="B2 Storage"
              fill="#10b981"
              stackId="a"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="B2 Downloads"
              fill="#06b6d4"
              stackId="a"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="B2 API"
              fill="#8b5cf6"
              stackId="a"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="S3 Storage"
              fill="#f59e0b"
              stackId="a"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="S3 Retrieval"
              fill="#ef4444"
              stackId="a"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {data.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Total (current month)</span>
            <span className="text-xl font-bold text-emerald-400">
              ${data[data.length - 1].total.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}