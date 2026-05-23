"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, Search, ExternalLink } from "lucide-react";
import { useAllInstructors } from "@/lib/queries/convex/use-instructors";
import { Id } from "@/convex/_generated/dataModel";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

type Instructor = {
  _id: Id<"instructors">;
  name?: string;
  slug?: string;
  tagline?: string;
  specialties?: string[];
  isActive?: boolean;
  deletedAt?: number;
  _creationTime?: number;
};

export default function InstructorsPage() {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: allInstructors, isLoading, refetch } = useAllInstructors();

  const instructors = useMemo(() => {
    if (!allInstructors) return [];

    let filtered = showInactive
      ? allInstructors
      // Treat undefined isActive as active for backward compatibility
      : allInstructors.filter((i: Instructor) => (i.isActive !== false) && !i.deletedAt);

    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter((i: Instructor) =>
        i.name?.toLowerCase().includes(searchLower) ||
        i.slug?.toLowerCase().includes(searchLower) ||
        i.specialties?.some(s => s.toLowerCase().includes(searchLower))
      );
    }

    return filtered;
  }, [allInstructors, showInactive, debouncedSearch]);

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Instructors</h1>
          <p className="text-muted-foreground mt-1">
            Manage instructor profiles
          </p>
        </div>
        <Link href="/admin/instructors/create">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Instructor
          </Button>
        </Link>
      </div>

      {/* Storage Image Backfill */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Backfill Images to Convex Storage</CardTitle>
          <CardDescription>
            Migrate profile, portfolio, and student result images into Convex Storage so they always serve signed URLs.
            Safe to run multiple times; already-migrated images are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackfillImagesPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search instructors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Show inactive</span>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : instructors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No instructors found.{" "}
              <Link href="/admin/instructors/create" className="text-primary hover:underline">
                Add one
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Name</th>
                    <th className="text-left py-3 px-4 font-medium">Slug</th>
                    <th className="text-left py-3 px-4 font-medium">Specialties</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Created</th>
                    <th className="text-right py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instructors.map((instructor: Instructor) => (
                    <tr key={instructor._id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{instructor.name}</td>
                      <td className="py-3 px-4 font-mono text-sm">{instructor.slug}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {instructor.specialties?.slice(0, 3).map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                          {instructor.specialties && instructor.specialties.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{instructor.specialties.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {/* Treat undefined isActive as active for consistency with filter semantics */}
                        <Badge variant={(instructor.isActive !== false) ? "default" : "destructive"}>
                          {(instructor.isActive !== false) ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {instructor._creationTime ? new Date(instructor._creationTime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/instructors/${instructor._id}/edit`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/instructors/${instructor.slug}`} target="_blank">
                            <Button variant="ghost" size="sm">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </td>
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

function BackfillImagesPanel() {
  type BackfillSummary = {
    processedProfiles: number;
    processedInstructors: number;
    processedPortfolioImages: number;
    processedStudentResults: number;
    skipped: number;
    errors: Array<{ kind: string; id: string; message: string }>;
  };

  type BackfillRequest = {
    baseUrl: string;
    includeStudentResults: boolean;
    dryRun: boolean;
    limit?: number;
  };
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);
  const [includeStudentResults, setIncludeStudentResults] = useState<boolean>(true);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [limit, setLimit] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunIsDry, setCurrentRunIsDry] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<BackfillSummary | null>(null);
  type BackfillResponse = { success?: boolean; summary?: BackfillSummary; error?: string };
  const [rawResponse, setRawResponse] = useState<BackfillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureBaseUrl = () => baseUrl.trim() || (typeof window !== "undefined" ? window.location.origin : "");

  async function runBackfill(runDry: boolean): Promise<void> {
    try {
      setIsRunning(true);
      setCurrentRunIsDry(runDry);
      setError(null);
      setSummary(null);
      setRawResponse(null);
      const body: BackfillRequest = {
        baseUrl: ensureBaseUrl(),
        includeStudentResults,
        dryRun: runDry,
      };
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n) && n > 0) body.limit = n;
      const res = await fetch("/api/admin/instructors/backfill-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: BackfillResponse = await res.json();
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`);
      } else {
        setSummary(json.summary ?? null);
        setRawResponse(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
      setCurrentRunIsDry(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Site Origin</label>
            <div className="flex gap-2 items-center">
              <Input
                value={baseUrl || (typeof window !== "undefined" ? window.location.origin : "")}
                onChange={(e) => setBaseUrl(e.target.value)}
                readOnly={!isEditingOrigin}
              />
              <Button variant="outline" size="sm" onClick={() => setIsEditingOrigin((v) => !v)}>
                {isEditingOrigin ? "Lock" : "Edit"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Used to turn relative paths into absolute URLs. Defaults to current site.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeStudentResults}
              onChange={(e) => setIncludeStudentResults(e.target.checked)}
            />
            <span className="text-sm">Include student results</span>
          </div>
        </div>

        <div>
          <button className="text-sm text-primary hover:underline" type="button" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">Batch limit</label>
                <Input
                  placeholder="e.g. 200"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                <span className="text-sm">Dry run (preview only)</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Button disabled={isRunning} onClick={() => runBackfill(true)} variant="outline">
            {isRunning && currentRunIsDry === true ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Preview
          </Button>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={confirmRun} onChange={(e) => setConfirmRun(e.target.checked)} />
            <span className="text-sm">I understand this writes storage IDs to production data</span>
          </div>
          <Button disabled={isRunning || !confirmRun} onClick={() => runBackfill(false)}>
            {isRunning && currentRunIsDry === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run Backfill
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600">{error}</div>
      )}

      {summary && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="Profiles" value={summary.processedProfiles} />
            <Stat label="Instructors" value={summary.processedInstructors} />
            <Stat label="Portfolio Images" value={summary.processedPortfolioImages} />
            <Stat label="Student Results" value={summary.processedStudentResults} />
            <Stat label="Skipped" value={summary.skipped} />
          </div>

          {summary.errors?.length ? (
            <div>
              <h4 className="font-medium mb-2">Errors ({summary.errors.length})</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2">Record</th>
                      <th className="text-left py-2 px-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errors.map((e, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="py-2 px-2 font-mono text-xs">{e.kind}</td>
                        <td className="py-2 px-2 font-mono text-xs">{e.id}</td>
                        <td className="py-2 px-2 break-all">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => downloadReport(rawResponse)}>
              Download report
            </Button>
            <Button variant="outline" onClick={() => { setSummary(null); setRawResponse(null); }}>Clear</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function downloadReport(obj: { success?: boolean; summary?: BackfillSummary; error?: string } | null): void {
  if (!obj) return;
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backfill-summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
