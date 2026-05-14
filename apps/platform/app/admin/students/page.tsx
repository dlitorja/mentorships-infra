"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Student = {
  id: string;
  userId: string;
  email: string;
  instructorId: string;
  instructorName: string;
  instructorSlug: string;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: string | null;
  purchasedAt: string;
};

type StudentsResponse = {
  items: Student[];
  total: number;
  page: number;
  pageSize: number;
};

async function fetchStudents(paramsIn: {
  search?: string;
  instructorId?: string;
  status?: string;
  expiresAfter?: number;
  expiresBefore?: number;
  purchasedAfter?: number;
  purchasedBefore?: number;
  remainingMin?: number;
  remainingMax?: number;
}): Promise<StudentsResponse> {
  const params = new URLSearchParams();
  if (paramsIn.search) params.set("search", paramsIn.search);
  if (paramsIn.instructorId) params.set("instructorId", paramsIn.instructorId);
  if (paramsIn.status) params.set("status", paramsIn.status);
  if (paramsIn.expiresAfter) params.set("expiresAfter", String(paramsIn.expiresAfter));
  if (paramsIn.expiresBefore) params.set("expiresBefore", String(paramsIn.expiresBefore));
  if (paramsIn.purchasedAfter) params.set("purchasedAfter", String(paramsIn.purchasedAfter));
  if (paramsIn.purchasedBefore) params.set("purchasedBefore", String(paramsIn.purchasedBefore));
  if (paramsIn.remainingMin !== undefined) params.set("remainingMin", String(paramsIn.remainingMin));
  if (paramsIn.remainingMax !== undefined) params.set("remainingMax", String(paramsIn.remainingMax));
  const url = `/api/admin/students${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<StudentsResponse>(url);
}

async function fetchInstructors() {
  return apiFetch<{ items: { id: string; name: string; slug: string }[] }>("/api/admin/instructors?includeInactive=true");
}

export default function StudentsPage() {
  const [search, setSearch] = useState("");
  const [instructorFilter, setInstructorFilter] = useState("");
  const [status, setStatus] = useState("");
  const [expiresAfter, setExpiresAfter] = useState("");
  const [expiresBefore, setExpiresBefore] = useState("");
  const [purchasedAfter, setPurchasedAfter] = useState("");
  const [purchasedBefore, setPurchasedBefore] = useState("");
  const [remainingMin, setRemainingMin] = useState("");
  const [remainingMax, setRemainingMax] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [
      "students",
      debouncedSearch,
      instructorFilter,
      status,
      expiresAfter,
      expiresBefore,
      purchasedAfter,
      purchasedBefore,
      remainingMin,
      remainingMax,
    ],
    queryFn: () => {
      const toStartOfDay = (d: string) => {
        const dt = new Date(d);
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).getTime();
        };
      const toEndOfDay = (d: string) => {
        const dt = new Date(d);
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
      };
      return fetchStudents({
        search: debouncedSearch || undefined,
        instructorId: instructorFilter || undefined,
        status: status || undefined,
        expiresAfter: expiresAfter ? toStartOfDay(expiresAfter) : undefined,
        expiresBefore: expiresBefore ? toEndOfDay(expiresBefore) : undefined,
        purchasedAfter: purchasedAfter ? toStartOfDay(purchasedAfter) : undefined,
        purchasedBefore: purchasedBefore ? toEndOfDay(purchasedBefore) : undefined,
        remainingMin: remainingMin ? Number(remainingMin) : undefined,
        remainingMax: remainingMax ? Number(remainingMax) : undefined,
      });
    },
  });

  const { data: instructorsData } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "depleted":
        return "destructive";
      case "expired":
        return "secondary";
      case "refunded":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Students</h1>
          <p className="text-muted-foreground mt-1">Manage students and their mentorship sessions</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/students/invite">
            <Button variant="outline">
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Student
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={instructorFilter} onValueChange={setInstructorFilter}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="All Instructors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Instructors</SelectItem>
                  {(instructorsData?.items ?? (instructorsData as any)?.instructors ?? []).map((inst: any) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="depleted">Depleted</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="date" value={expiresAfter} onChange={(e) => setExpiresAfter(e.target.value)} placeholder="Expires After" />
                <Input type="date" value={expiresBefore} onChange={(e) => setExpiresBefore(e.target.value)} placeholder="Expires Before" />
              </div>
              <div className="flex gap-2">
                <Input type="date" value={purchasedAfter} onChange={(e) => setPurchasedAfter(e.target.value)} placeholder="Purchased After" />
                <Input type="date" value={purchasedBefore} onChange={(e) => setPurchasedBefore(e.target.value)} placeholder="Purchased Before" />
              </div>
              <div className="flex gap-2">
                <Input type="number" min={0} value={remainingMin} onChange={(e) => setRemainingMin(e.target.value)} placeholder="Min Remaining" />
                <Input type="number" min={0} value={remainingMax} onChange={(e) => setRemainingMax(e.target.value)} placeholder="Max Remaining" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (data?.items ?? []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No students found. {""}
              <Link href="/admin/students/invite" className="text-primary hover:underline">
                Invite a student
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Student</th>
                    <th className="text-left py-3 px-4 font-medium">Instructor</th>
                    <th className="text-left py-3 px-4 font-medium">Sessions</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((student) => (
                    <tr key={student.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{student.email}</div>
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">{student.userId}</div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {student.instructorSlug ? (
                          <Link href={`/instructors/${student.instructorSlug}`} target="_blank" className="text-primary hover:underline">
                            {student.instructorName}
                          </Link>
                        ) : (
                          <span>{student.instructorName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={
                            student.remainingSessions === 0
                              ? "text-destructive font-medium"
                              : student.remainingSessions <= 2
                              ? "text-yellow-600 font-medium"
                              : ""
                          }
                        >
                          {student.remainingSessions} / {student.totalSessions}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={getStatusColor(student.status)}>{student.status}</Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {student.expiresAt ? new Date(student.expiresAt).toLocaleDateString() : "—"}
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
