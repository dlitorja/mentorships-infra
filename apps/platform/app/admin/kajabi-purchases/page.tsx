"use client";

import React, { useState } from "react";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Inbox } from "lucide-react";
import {
  useKajabiPurchases,
  type KajabiPurchaseStatus,
} from "@/lib/queries/convex/use-kajabi-purchases";

const STATUS_TABS: Array<{ value: KajabiPurchaseStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "dismissed", label: "Dismissed" },
];

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function typeLabel(type: "one-on-one" | "group" | "unknown"): string {
  if (type === "one-on-one") return "1-on-1";
  if (type === "group") return "Group";
  return "Unknown";
}

export default function AdminKajabiPurchasesPage(): React.JSX.Element {
  const [status, setStatus] = useState<KajabiPurchaseStatus>("pending");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useKajabiPurchases(status, cursor);
  const items = data?.items ?? [];
  const router = useRouter();

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/admin/kajabi-purchases/sync", {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMessage(json.error ?? "Sync failed");
        return;
      }
      setSyncMessage("Sync started. New confirmations usually appear within a minute.");
      setTimeout(() => {
        void refetch();
      }, 5000);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Kajabi purchases</h1>
          <p className="text-sm text-muted-foreground">
            Purchase confirmations received at support@. Nothing is created
            until an admin approves a row.
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline">
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sync now
        </Button>
      </div>

      {syncMessage ? (
        <p className="text-sm text-muted-foreground">{syncMessage}</p>
      ) : null}

      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={status === tab.value ? "default" : "outline"}
            onClick={() => {
              setStatus(tab.value);
              setCursor(undefined);
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            {STATUS_TABS.find((t) => t.value === status)?.label} confirmations
          </CardTitle>
          <CardDescription>
            Review the parsed details and the raw email before approving.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {status} confirmations.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-2">Received</th>
                    <th className="p-2">Student</th>
                    <th className="p-2">Offer</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Purchase ID</th>
                    <th className="p-2">Status</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="whitespace-nowrap p-2 text-muted-foreground">
                        {formatDateTime(row.receivedAt)}
                      </td>
                      <td className="p-2">
                        <div className="font-medium">
                          {row.studentName ?? "Unknown student"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.studentEmail ?? "No email found"}
                        </div>
                      </td>
                      <td className="p-2">{row.offerTitle}</td>
                      <td className="p-2">
                        <Badge variant="outline">
                          {typeLabel(row.purchaseType)}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {row.kajabiPurchaseId ?? "—"}
                        {row.conflictWith ? (
                          <Badge variant="destructive" className="ml-2">
                            Conflict
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            row.status === "approved"
                              ? "secondary"
                              : row.status === "dismissed"
                                ? "outline"
                                : "default"
                          }
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(`/admin/kajabi-purchases/${row._id}`)
                          }
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cursor || data?.nextCursor ? (
                <div className="mt-3 flex justify-center gap-2">
                  {cursor ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCursor(undefined)}
                    >
                      ← Newest
                    </Button>
                  ) : null}
                  {data?.nextCursor ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCursor(data.nextCursor)}
                    >
                      Older →
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
