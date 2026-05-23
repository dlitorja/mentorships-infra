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
          <CardTitle>Backfill Storage Images</CardTitle>
          <CardDescription>
            Upload existing profile, portfolio, and student result images to Convex Storage and update records.
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
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [includeStudentResults, setIncludeStudentResults] = useState<boolean>(true);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [limit, setLimit] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureBaseUrl = () => baseUrl.trim() || (typeof window !== "undefined" ? window.location.origin : "");

  async function runBackfill(runDry: boolean) {
    try {
      setIsRunning(true);
      setError(null);
      setResult(null);
      const body: any = {
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
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`);
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Base URL</label>
          <Input
            placeholder="https://your-domain.example"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Defaults to current site origin if left blank.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Limit (optional)</label>
          <Input
            placeholder="e.g. 200"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeStudentResults}
              onChange={(e) => setIncludeStudentResults(e.target.checked)}
            />
            <span className="text-sm">Include student results</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            <span className="text-sm">Dry run</span>
          </label>
        </div>
      </div>

      <div className="flex gap-3">
        <Button disabled={isRunning} onClick={() => runBackfill(true)} variant="outline">
          {isRunning && dryRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Preview
        </Button>
        <Button disabled={isRunning} onClick={() => runBackfill(false)}>
          {isRunning && !dryRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Run Backfill
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-600">{error}</div>
      )}

      {result && (
        <div className="text-sm">
          <pre className="whitespace-pre-wrap break-words bg-muted/50 p-3 rounded-md">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
