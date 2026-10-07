"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  TrendingUp,
  HelpCircle,
} from "lucide-react";

// Recharts is a heavy dep and only renders the trend chart. Lazy-load
// it with ssr:false so the table + counters render immediately while
// the chart hydrates on the client.
const DailyTrendChart = dynamic(
  () => import("./email-metrics-trend-chart").then((m) => m.DailyTrendChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full flex items-center justify-center text-sm text-muted-foreground">
        Loading trend chart…
      </div>
    ),
  },
);

const SEVERITY_STYLES = {
  red: {
    badge: "bg-red-100 text-red-800 border-red-200",
    label: "Critical",
    icon: ShieldAlert,
  },
  yellow: {
    badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
    label: "Warning",
    icon: AlertTriangle,
  },
  green: {
    badge: "bg-green-100 text-green-800 border-green-200",
    label: "Healthy",
    icon: CheckCircle2,
  },
  unknown: {
    badge: "bg-gray-100 text-gray-700 border-gray-200",
    label: "Unknown",
    icon: HelpCircle,
  },
} as const;

export type EmailMetricsOverlay = {
  windowDays: number;
  byDate: Array<{
    date: string;
    delivery: number;
    bounce: number;
    complaint: number;
    open: number;
    click: number;
    webhookBounces: number;
    webhookComplaints: number;
    webhookUnsubscribes: number;
    webhookRemoved: number;
    webhookTotal: number;
    divergencePct: number;
    severity: "red" | "yellow" | "green" | "unknown";
    openRate: number;
    clickRate: number;
    bounceRate: number;
    complaintRate: number;
  }>;
  totals: {
    apiDelivery: number;
    apiBounce: number;
    apiComplaint: number;
    apiOpen: number;
    apiClick: number;
    webhookBounces: number;
    webhookComplaints: number;
    webhookUnsubscribes: number;
    webhookRemoved: number;
    webhookTotal: number;
    divergentDays: number;
    redDays: number;
  };
  sources: {
    apiLatestIngestedAt: number;
    webhookScannedRows: number;
    webhookHighWater: number;
    webhookHighWaterExceeded: boolean;
  };
};

type Props = {
  overlay: EmailMetricsOverlay;
};

function formatTimestamp(ms: number): string {
  if (ms === 0) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function formatDateShort(isoDate: string): string {
  return isoDate.slice(5);
}

export function EmailMetricsTrendCard({ overlay }: Props): React.JSX.Element {
  const chartData = overlay.byDate.map((d) => ({
    date: formatDateShort(d.date),
    Delivery: d.delivery,
    Bounce: d.bounce,
    Complaint: d.complaint,
    Open: d.open,
    Click: d.click,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Daily Volume Trend
        </CardTitle>
        <CardDescription>
          Resend API counts over the last {overlay.windowDays} days. Each row
          below the chart compares the API bounce+complaint count against the
          webhook bounce+complaint count. Rows where the two counts differ by at
          least 10% are flagged yellow; at least 25% are red. The webhook count
          is treated as ground truth, so a flagged row simply means the API
          aggregate does not match the webhook aggregate by that threshold —
          investigate the underlying source. Days where the scan could not fully
          enumerate webhook events show as &quot;Unknown&quot; rather than a
          misleading color.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              API Delivery
            </p>
            <p className="text-2xl font-semibold">
              {overlay.totals.apiDelivery}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              API Bounce
            </p>
            <p className="text-2xl font-semibold">{overlay.totals.apiBounce}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              API Complaint
            </p>
            <p className="text-2xl font-semibold">
              {overlay.totals.apiComplaint}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              Webhook Total
            </p>
            <p className="text-2xl font-semibold">
              {overlay.totals.webhookTotal}
              {overlay.sources.webhookHighWaterExceeded && (
                <span
                  className="text-sm font-normal text-yellow-600 ml-2"
                  title="Some webhook rows were dropped because the scan hit the high-water mark; this total is a lower bound."
                >
                  (partial)
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              Divergent Days
            </p>
            <p className="text-2xl font-semibold">
              {overlay.totals.divergentDays}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / {overlay.windowDays}
              </span>
            </p>
          </div>
        </div>

        <DailyTrendChart data={chartData} />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2 pr-4 text-right">Delivery</th>
                <th className="py-2 pr-4 text-right">Bounce %</th>
                <th className="py-2 pr-4 text-right">Complaint %</th>
                <th className="py-2 pr-4 text-right">Open %</th>
                <th className="py-2 pr-4 text-right">Click %</th>
                <th className="py-2 pr-4 text-right">API BC</th>
                <th className="py-2 pr-4 text-right">Webhook BC</th>
                <th className="py-2 pr-4 text-right">Divergence</th>
              </tr>
            </thead>
            <tbody>
              {overlay.byDate.map((d) => {
                const style = SEVERITY_STYLES[d.severity];
                const Icon = style.icon;
                return (
                  <tr key={d.date} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 font-medium">{d.date}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className={style.badge}>
                        <Icon className="h-3 w-3 mr-1" />
                        {style.label}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-right">{d.delivery}</td>
                    <td className="py-2 pr-4 text-right">{d.bounceRate}%</td>
                    <td className="py-2 pr-4 text-right">{d.complaintRate}%</td>
                    <td className="py-2 pr-4 text-right">{d.openRate}%</td>
                    <td className="py-2 pr-4 text-right">{d.clickRate}%</td>
                    <td className="py-2 pr-4 text-right">
                      {d.bounce + d.complaint}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {d.webhookBounces + d.webhookComplaints}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right font-medium ${
                        d.severity === "red"
                          ? "text-red-700"
                          : d.severity === "yellow"
                            ? "text-yellow-700"
                            : d.severity === "unknown"
                              ? "text-gray-500"
                              : "text-muted-foreground"
                      }`}
                    >
                      {d.severity === "unknown" ? "—" : `${d.divergencePct}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          API ingestion last ran at{" "}
          {formatTimestamp(overlay.sources.apiLatestIngestedAt)} · webhook scan
          read {overlay.sources.webhookScannedRows} rows
          {overlay.sources.webhookHighWaterExceeded && (
            <span className="text-yellow-600 ml-2">
              · Scan exceeded high-water mark of{" "}
              {overlay.sources.webhookHighWater} — narrow the window to surface
              per-day webhook counts reliably.
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
