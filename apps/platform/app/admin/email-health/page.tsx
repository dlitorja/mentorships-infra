import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, AlertTriangle, ShieldAlert, CheckCircle2 } from "lucide-react";

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

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminEmailHealthPage(): Promise<React.JSX.Element> {
  await requireRole("admin");
  const token = await getConvexAuthToken();

  const summary = await fetchQuery(
    api.queries.emailHealth.getEmailHealthSummary,
    { windowDays: 7 },
    { token: token ?? undefined }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Mail className="h-7 w-7" />
          Email Health
        </h1>
        <p className="text-muted-foreground mt-1">
          Suppression events over the last {summary.windowDays} days ·{" "}
          {summary.scannedRows} rows scanned
          {summary.truncated && (
            <span className="text-yellow-600 ml-2">
              (cap reached at {summary.scanCap} rows — query a smaller window)
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardDescription>Domains</CardDescription>
            <CardTitle className="text-3xl">{summary.totals.domains}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bounces</CardDescription>
            <CardTitle className="text-3xl">{summary.totals.bounces}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Complaints</CardDescription>
            <CardTitle className="text-3xl">{summary.totals.complaints}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Unsubscribes</CardDescription>
            <CardTitle className="text-3xl">{summary.totals.unsubscribes}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Removals</CardDescription>
            <CardTitle className="text-3xl">{summary.totals.removed}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {summary.deniedDomains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Denied Domains</CardTitle>
            <CardDescription>
              Domains manually flagged. Cron does not auto-populate this list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.deniedDomains.map((d) => (
              <div
                key={`${d.domain}:${d.kind}`}
                className="flex items-center justify-between border-b pb-2 last:border-b-0"
              >
                <div>
                  <p className="font-medium">{d.domain}</p>
                  <p className="text-xs text-muted-foreground">
                    first denied {formatTimestamp(d.firstDeniedAt)} · last{" "}
                    {formatTimestamp(d.lastDeniedAt)} · kind: {d.kind}
                    {d.note ? ` · ${d.note}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                  Denied
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Per-Domain Rates</CardTitle>
          <CardDescription>
            Sorted by severity. Thresholds are absolute counts over the window
            (rates arrive with PR Metrics 3b once delivered counts land).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.domains.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No suppression events in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Severity</th>
                    <th className="py-2 pr-4">Domain</th>
                    <th className="py-2 pr-4 text-right">Bounces</th>
                    <th className="py-2 pr-4 text-right">Complaints</th>
                    <th className="py-2 pr-4 text-right">Unsubscribes</th>
                    <th className="py-2 pr-4 text-right">Removals</th>
                    <th className="py-2 pr-4">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.domains.map((d) => {
                    const style = SEVERITY_STYLES[d.severity];
                    const Icon = style.icon;
                    return (
                      <tr key={d.domain} className="border-b last:border-b-0">
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className={style.badge}>
                            <Icon className="h-3 w-3 mr-1" />
                            {style.label}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 font-medium">{d.domain}</td>
                        <td className="py-2 pr-4 text-right">{d.bounces}</td>
                        <td className="py-2 pr-4 text-right">{d.complaints}</td>
                        <td className="py-2 pr-4 text-right">{d.unsubscribes}</td>
                        <td className="py-2 pr-4 text-right">{d.removed}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {formatTimestamp(d.lastOccurredAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Suppression Events</CardTitle>
          <CardDescription>
            Last {summary.recentEvents.length} of {summary.scannedRows} scanned events
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.recentEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4">Domain</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Bounce Type</th>
                    <th className="py-2 pr-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentEvents.map((e) => (
                    <tr key={`${e.resendId}:${e.kind}`} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatTimestamp(e.occurredAt)}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{e.kind}</Badge>
                      </td>
                      <td className="py-2 pr-4 font-medium">{e.domain}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{e.email}</td>
                      <td className="py-2 pr-4">{e.bounceType ?? "—"}</td>
                      <td className="py-2 pr-4">{e.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
