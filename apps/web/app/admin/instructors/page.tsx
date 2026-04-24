"use client";

import React, { useState } from "react";
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
import { apiFetch } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

type Instructor = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  specialties: string[];
  isActive: boolean;
  createdAt: string;
};

type InstructorsResponse = {
  items: Instructor[];
  total: number;
  page: number;
  pageSize: number;
};

async function fetchInstructors(search?: string, includeInactive?: boolean): Promise<InstructorsResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (includeInactive) params.set("includeInactive", "true");
  
  const url = `/api/admin/instructors${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<InstructorsResponse>(url);
}

async function deleteInstructor(id: string) {
  const response = await fetch(`/api/admin/instructors/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete instructor");
  }
  return response.json();
}

export default function InstructorsPage() {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["instructors", debouncedSearch, showInactive],
    queryFn: () => fetchInstructors(debouncedSearch, showInactive),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInstructor,
    onSuccess: () => {
      refetch();
    },
  });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete instructor");
    }
  };

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
          ) : data?.items.length === 0 ? (
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
                  {data?.items.map((instructor) => (
                    <tr key={instructor.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{instructor.name}</td>
                      <td className="py-3 px-4 font-mono text-sm">{instructor.slug}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {instructor.specialties?.slice(0, 3).map((s) => (
                            <Badge key={s} variant="secondary" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                          {instructor.specialties?.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{instructor.specialties.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={instructor.isActive ? "default" : "destructive"}>
                          {instructor.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {new Date(instructor.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/instructors/${instructor.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(instructor.id, instructor.name)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
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
