import Link from "next/link";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, ShieldAlert } from "lucide-react";

export async function EmailHealthSummaryCard(): Promise<React.JSX.Element | null> {
  const token = await getConvexAuthToken();
  if (!token) return null;

  let summary;
  try {
    summary = await fetchQuery(
      api.queries.emailHealth.getEmailHealthSummary,
      { windowDays: 7 },
      { token }
    );
  } catch {
    return null;
  }

  const hasDenied = summary.deniedDomains.length > 0;
  const redDomains = summary.domains.filter((d) => d.severity === "red");

  if (!hasDenied && redDomains.length === 0) return null;

  return (
    <Card className="border-red-200 bg-red-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-800">
          <ShieldAlert className="h-5 w-5" />
          Email Health Alert
        </CardTitle>
        <CardDescription>
          {hasDenied
            ? `${summary.deniedDomains.length} denied domain${summary.deniedDomains.length === 1 ? "" : "s"}`
            : `${redDomains.length} domain${redDomains.length === 1 ? "" : "s"} above threshold`}
          {" "}over the last {summary.windowDays} days
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {redDomains.slice(0, 3).map((d) => (
          <div key={d.domain} className="text-sm">
            <strong className="text-red-900">{d.domain}</strong>
            <span className="text-muted-foreground ml-2">
              {d.bounces} bounce{d.bounces === 1 ? "" : "s"}
              {d.complaints > 0 ? ` · ${d.complaints} complaint${d.complaints === 1 ? "" : "s"}` : ""}
            </span>
          </div>
        ))}
        {hasDenied && (
          <div className="text-sm text-muted-foreground">
            Denied: {summary.deniedDomains.map((d) => d.domain).join(", ")}
          </div>
        )}
        <Link href="/admin/email-health">
          <Button variant="outline" className="mt-2">
            <Mail className="h-4 w-4 mr-2" />
            Open Email Health
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
