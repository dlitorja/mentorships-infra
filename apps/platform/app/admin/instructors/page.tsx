"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, Plus, Pencil, Search, ExternalLink, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { deleteAdminInstructor } from "@/lib/queries/api-client";
import { useAllInstructors } from "@/lib/queries/convex/use-instructors";
import { Id } from "@/convex/_generated/dataModel";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { BackfillImagesPanel } from "./_components/backfill-images-panel";

type Instructor = {
  _id: Id<"instructors">;
  name?: string;
  slug?: string;
  email?: string;
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
  const showInactiveId = React.useId();

  const [purgeInstructor, setPurgeInstructor] = useState<Instructor | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);

  const { data: allInstructors, isLoading, refetch } = useAllInstructors();

  const hardDeleteInstructorMutation = useMutation({
    mutationFn: async (id: Id<"instructors">) => {
      return deleteAdminInstructor(id, true);
    },
    onSuccess: () => {
      setPurgeInstructor(null);
      setPurgeError(null);
      setIsPurging(false);
      refetch();
    },
    onError: (error: Error) => {
      setPurgeError(error.message);
      setIsPurging(false);
    },
  });

  async function handlePurge(instructor: Instructor) {
    if (!instructor._id) return;
    setIsPurging(true);
    setPurgeError(null);
    try {
      await hardDeleteInstructorMutation.mutateAsync(instructor._id);
    } catch {
      // Error is handled in onError
    }
  }

  const instructors = useMemo(() => {
    if (!allInstructors) return [];

    const hasNameOrSlug = (i: Instructor): boolean => !!(i.name || i.slug);

    let filtered = showInactive
      ? allInstructors
      // Treat undefined isActive as active for backward compatibility
      // Also filter out instructors without name or slug (defensive measure to hide incomplete records)
      : allInstructors.filter((i: Instructor) => (i.isActive !== false) && !i.deletedAt && hasNameOrSlug(i));

    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter((i: Instructor) =>
        i.name?.toLowerCase().includes(searchLower) ||
        i.email?.toLowerCase().includes(searchLower) ||
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
                placeholder="Search instructors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={showInactiveId}
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(checked === true)}
              />
              <Label htmlFor={showInactiveId} className="cursor-pointer">
                Show inactive
              </Label>
            </div>
            <span className="text-xs text-muted-foreground">
              (Showing up to 100 instructors)
            </span>
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
                          {instructor.isActive !== false ? (
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
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {instructor._creationTime ? new Date(instructor._creationTime).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/instructors/${instructor._id}/edit`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${instructor.name ?? "instructor"}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          {instructor.slug && (
                            <Link href={`/instructors/${instructor.slug}`} target="_blank">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`View public profile for ${instructor.name ?? "instructor"}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
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

      <Dialog open={!!purgeInstructor} onOpenChange={(open) => !open && (setPurgeInstructor(null), setPurgeError(null), setIsPurging(false))}>
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
            <Button variant="outline" onClick={() => { setPurgeInstructor(null); setPurgeError(null); setIsPurging(false); }} disabled={isPurging}>
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


