"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  Pencil,
  Search,
  ExternalLink,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  deleteAdminInstructor,
  getAdminInstructors,
  type AdminInstructorListItem,
} from "@/lib/queries/api-client";
import { Id } from "@/convex/_generated/dataModel";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { BackfillImagesPanel } from "./_components/backfill-images-panel";

type Instructor = AdminInstructorListItem;

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "deleted", label: "Deleted" },
  { value: "all", label: "All" },
] as const;

/**
 * `useAllInstructors` returned at most 100 rows with no way to reach the rest,
 * and the table showed no capacity data even though the REST endpoint returns
 * it. The list now asks the API for a page, a filter and a search, so the count
 * is real and the tail is reachable.
 */
export default function InstructorsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 300);

  // Reset the page during render when filters change, so the first request for a
  // new filter is already page 1.
  const filtersKey = JSON.stringify([debouncedSearch, statusFilter]);
  const lastFiltersRef = React.useRef(filtersKey);
  if (lastFiltersRef.current !== filtersKey) {
    lastFiltersRef.current = filtersKey;
    if (page !== 1) setPage(1);
  }

  const [purgeInstructor, setPurgeInstructor] = useState<Instructor | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-instructors", statusFilter, debouncedSearch, page],
    queryFn: () =>
      getAdminInstructors({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter,
        search: debouncedSearch || undefined,
      }),
  });

  const instructors = data?.instructors ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = (page - 1) * PAGE_SIZE + instructors.length;

  // Deleting the last row on the final page leaves `page` beyond the end; the
  // roster would render an empty state with the pager hidden. Clamp during
  // render so the refetch asks for a page that exists.
  if (data && page > totalPages) {
    setPage(totalPages);
  }

  const hardDeleteInstructorMutation = useMutation({
    mutationFn: async (id: Id<"instructors">) => {
      return deleteAdminInstructor(id, true);
    },
    onSuccess: () => {
      setPurgeInstructor(null);
      setPurgeError(null);
      setIsPurging(false);
      // Invalidate every roster page, not just the current one: after deleting
      // the last row on the final page the view has to fall back to a page that
      // still exists, and that page's cache also holds the deleted row.
      queryClient.invalidateQueries({ queryKey: ["admin-instructors"] });
    },
    onError: (error: Error) => {
      setPurgeError(error.message);
      setIsPurging(false);
    },
  });

  async function handlePurge(instructor: Instructor) {
    if (!instructor.instructorId) return;
    setIsPurging(true);
    setPurgeError(null);
    try {
      await hardDeleteInstructorMutation.mutateAsync(instructor.instructorId as Id<"instructors">);
    } catch {
      // Error is handled in onError
    }
  }

  const displayName = (instructor: Instructor) =>
    instructor.name || instructor.email || instructor.slug || "Unnamed instructor";

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Instructors</h1>
          <p className="text-muted-foreground mt-1">Manage instructor profiles</p>
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
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Backfill Images to Convex Storage</CardTitle>
              <CardDescription>
                Migrate profile, portfolio, and student result images into Convex Storage so they always serve signed URLs.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBackfill((prev) => !prev)}
              aria-expanded={showBackfill}
            >
              Advanced
              {showBackfill ? (
                <ChevronUp className="ml-2 h-4 w-4" />
              ) : (
                <ChevronDown className="ml-2 h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        {showBackfill && (
          <CardContent id="backfill-images-panel" className="pt-6">
            <BackfillImagesPanel />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, slug or specialty..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search instructors"
              />
            </div>
            <div className="flex items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="instructor-status" className="w-[150px]" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {total === 0 ? "No results" : `Showing ${firstOnPage}–${lastOnPage} of ${total}`}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    Couldn&apos;t load instructors
                  </p>
                  <p className="text-xs text-destructive/80 mt-1">
                    {error instanceof Error ? error.message : "The request failed."} The roster below is
                    not an empty roster — treat instructor state as unknown until this reloads.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : instructors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {debouncedSearch || statusFilter !== "active" ? (
                <>
                  No instructors match this filter.{" "}
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("active");
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  No instructors found.{" "}
                  <Link href="/admin/instructors/create" className="text-primary hover:underline">
                    Add one
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Name</th>
                      <th className="text-left py-3 px-4 font-medium">Specialties</th>
                      <th className="text-left py-3 px-4 font-medium">Status</th>
                      <th className="text-left py-3 px-4 font-medium">Students</th>
                      <th className="text-left py-3 px-4 font-medium">Inventory</th>
                      <th className="text-left py-3 px-4 font-medium">Created</th>
                      <th className="text-right py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instructors.map((instructor) => {
                      const isDeleted = instructor.deletedAt != null;
                      const isActive = instructor.isActive !== false;
                      return (
                        <tr key={instructor.instructorId} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4">
                            <div className="font-medium">{displayName(instructor)}</div>
                            {instructor.email && (
                              <div className="text-xs text-muted-foreground break-all">
                                {instructor.email}
                              </div>
                            )}
                            {instructor.slug && (
                              <div className="text-xs text-muted-foreground/70 font-mono">
                                /instructors/{instructor.slug}
                              </div>
                            )}
                          </td>
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
                            <div className="flex flex-wrap items-center gap-1">
                              {isDeleted ? (
                                <Badge variant="outline" title="Soft-deleted; not visible to students">
                                  Deleted
                                </Badge>
                              ) : (
                                <Badge variant={isActive ? "default" : "destructive"}>
                                  {isActive ? (
                                    <>
                                      <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />
                                      Active
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="h-3 w-3 mr-1" aria-hidden="true" />
                                      Inactive
                                    </>
                                  )}
                                </Badge>
                              )}
                              {instructor.isListed === false && (
                                <Badge variant="secondary" title="Hidden from the public instructor list">
                                  Unlisted
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium">{instructor.activeStudentCount ?? 0}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {instructor.maxActiveStudents || "—"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm">
                            <div className="flex flex-col">
                              <span>1:1 {instructor.oneOnOneInventory ?? 0}</span>
                              <span className="text-muted-foreground">
                                Group {instructor.groupInventory ?? 0}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-muted-foreground">
                            {instructor.createdAt
                              ? new Date(instructor.createdAt).toLocaleDateString()
                              : "N/A"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-2">
                              <Link href={`/admin/instructors/${instructor.instructorId}/edit`}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Edit ${displayName(instructor)}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </Link>
                              {instructor.slug && (
                                <Link href={`/instructors/${instructor.slug}`} target="_blank">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`View public profile for ${displayName(instructor)}`}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                              {!isDeleted && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPurgeInstructor(instructor)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  aria-label="Delete instructor"
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                  <span className="ml-2 hidden sm:inline">Delete</span>
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || isLoading}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages || isLoading}
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!purgeInstructor}
        onOpenChange={(open) =>
          !open && (setPurgeInstructor(null), setPurgeError(null), setIsPurging(false))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete Instructor
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. The instructor &quot;{purgeInstructor?.name}&quot; will be
              permanently removed from the database. Related records (sessions, bookings, etc.)
              will remain but lose their instructor reference.
            </DialogDescription>
          </DialogHeader>
          {purgeError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {purgeError}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setPurgeInstructor(null);
                setPurgeError(null);
                setIsPurging(false);
              }}
              disabled={isPurging}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => purgeInstructor && handlePurge(purgeInstructor)}
              disabled={isPurging}
            >
              {isPurging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
