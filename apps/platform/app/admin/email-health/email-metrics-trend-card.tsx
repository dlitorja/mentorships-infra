"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";

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
    severity: "red" | "yellow" | "green";
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
    divergentDays: number;
    redDays: number;
  };
  sources: {
    apiLatestIngestedAt: number;
    webhookScannedRows: number;
    webhookScanCap: number;
    webhookTruncated: boolean;
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
          below the chart compares the API aggregate (volume baseline) with the
          webhook aggregate (ground truth). Rows diverge by more than 10% are
          flagged yellow; more than 25% are red — indicating the API ingestion
          missed events the webhook caught.
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
              {overlay.totals.webhookBounces +
                overlay.totals.webhookComplaints +
                overlay.totals.webhookUnsubscribes}
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

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="Delivery"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="Bounce"
                stroke="#dc2626"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="Complaint"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="Open"
                stroke="#2563eb"
                strokeWidth={1}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="Click"
                stroke="#7c3aed"
                strokeWidth={1}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

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
                <th className="py-2 pr-4 text-right">Webhook</th>
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
                    <td className="py-2 pr-4 text-right">{d.webhookTotal}</td>
                    <td
                      className={`py-2 pr-4 text-right font-medium ${
                        d.divergencePct >= 25
                          ? "text-red-700"
                          : d.divergencePct >= 10
                            ? "text-yellow-700"
                            : "text-muted-foreground"
                      }`}
                    >
                      {d.divergencePct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          API ingestion last ran at{" "}
          {formatTimestamp(overlay.sources.apiLatestIngestedAt)}
          {overlay.sources.webhookTruncated && (
            <span className="text-yellow-600 ml-2">
              · Webhook scan hit cap of {overlay.sources.webhookScanCap} rows —
              narrow the window or wait for the next cron pass.
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
