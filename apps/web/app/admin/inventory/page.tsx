"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Minus } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { z } from "zod";

type MentorWithInstructor = {
  id: string;
  userId: string | null;
  email: string | null;
  maxActiveStudents: number;
  oneOnOneInventory: number;
  groupInventory: number;
  createdAt: string;
  instructorId: string | null;
  instructorName: string | null;
  instructorSlug: string | null;
};

type WaitlistEntry = {
  id: string;
  email: string;
  type: string;
  notified: boolean;
  createdAt: string;
};

const mentorsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      userId: z.string().nullable(),
      email: z.string().nullable(),
      maxActiveStudents: z.number(),
      oneOnOneInventory: z.number(),
      groupInventory: z.number(),
      createdAt: z.string(),
      instructorId: z.string().nullable(),
      instructorName: z.string().nullable(),
      instructorSlug: z.string().nullable(),
    })
  ),
});

type MentorsResponse = z.infer<typeof mentorsResponseSchema>;

const waitlistResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      type: z.string(),
      notified: z.boolean(),
      createdAt: z.string(),
    })
  ),
});

type WaitlistResponse = z.infer<typeof waitlistResponseSchema>;

async function fetchMentors(): Promise<MentorsResponse> {
  return apiFetch<MentorsResponse>("/api/admin/mentors");
}

async function fetchWaitlist(instructorSlug: string): Promise<WaitlistResponse> {
  return apiFetch<WaitlistResponse>(`/api/admin/waitlist/${instructorSlug}`);
}

async function updateInventory(
  mentorId: string,
  data: { oneOnOneInventory?: number; groupInventory?: number }
) {
  const response = await fetch(`/api/admin/inventory/${mentorId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update inventory");
  }
  return response.json();
}

async function notifyWaitlist(data: { instructorSlug: string; mentorshipType: string }) {
  const response = await fetch(`/api/admin/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to notify waitlist");
  }
  return response.json();
}

async function markNotified(entryIds: string[]) {
  const response = await fetch(`/api/admin/waitlist`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryIds }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to mark as notified");
  }
  return response.json();
}

async function deleteWaitlistEntries(ids: string[]) {
  const response = await fetch(`/api/admin/waitlist?ids=${ids.join(",")}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete entries");
  }
  return response.json();
}

export default function InventoryPage() {
  const [filter, setFilter] = useState<"all" | "available">("all");
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [selectedMentor, setSelectedMentor] = useState<MentorWithInstructor | null>(null);
  const [waitlistTab, setWaitlistTab] = useState<"oneOnOne" | "group">("oneOnOne");
  const [selectedWaitlistEntries, setSelectedWaitlistEntries] = useState<string[]>([]);

  const {
    data: mentorsData,
    isLoading: mentorsLoading,
    refetch: refetchMentors,
  } = useQuery({
    queryKey: ["mentors"],
    queryFn: fetchMentors,
  });

  const {
    data: waitlistData,
    isLoading: waitlistLoading,
    refetch: refetchWaitlist,
  } = useQuery({
    queryKey: ["waitlist", selectedMentor?.instructorSlug],
    queryFn: () => fetchWaitlist(selectedMentor!.instructorSlug!),
    enabled: !!selectedMentor?.instructorSlug,
  });

  const updateInventoryMutation = useMutation({
    mutationFn: ({
      mentorId,
      data,
    }: {
      mentorId: string;
      data: { oneOnOneInventory?: number; groupInventory?: number };
    }) => updateInventory(mentorId, data),
    onSuccess: () => {
      refetchMentors();
    },
  });

  const notifyWaitlistMutation = useMutation({
    mutationFn: (data: { instructorSlug: string; mentorshipType: string }) =>
      notifyWaitlist(data),
    onSuccess: () => {
      refetchWaitlist();
      alert("Waitlist notified successfully");
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const markNotifiedMutation = useMutation({
    mutationFn: (entryIds: string[]) => markNotified(entryIds),
    onSuccess: () => {
      refetchWaitlist();
      setSelectedWaitlistEntries([]);
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const deleteWaitlistEntriesMutation = useMutation({
    mutationFn: (ids: string[]) => deleteWaitlistEntries(ids),
    onSuccess: () => {
      refetchWaitlist();
      setSelectedWaitlistEntries([]);
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const handleAdjustInventory = (
    mentor: MentorWithInstructor,
    type: "oneOnOne" | "group",
    delta: number
  ) => {
    const currentValue = type === "oneOnOne" ? mentor.oneOnOneInventory : mentor.groupInventory;
    const newValue = currentValue + delta;
    if (newValue < 0) return;

    updateInventoryMutation.mutate({
      mentorId: mentor.id,
      data: type === "oneOnOne" ? { oneOnOneInventory: newValue } : { groupInventory: newValue },
    });
  };

  const handleSetInventory = (
    mentor: MentorWithInstructor,
    type: "oneOnOne" | "group",
    value: number
  ) => {
    if (value < 0) return;

    updateInventoryMutation.mutate({
      mentorId: mentor.id,
      data: type === "oneOnOne" ? { oneOnOneInventory: value } : { groupInventory: value },
    });
  };

  const handleNotifyWaitlist = (mentor: MentorWithInstructor, type: "oneOnOne" | "group") => {
    if (!mentor.instructorSlug) return;
    notifyWaitlistMutation.mutate({
      instructorSlug: mentor.instructorSlug,
      mentorshipType: type,
    });
  };

  const handleOpenWaitlist = (mentor: MentorWithInstructor) => {
    setSelectedMentor(mentor);
    setSelectedWaitlistEntries([]);
    setShowWaitlistModal(true);
  };

  const handleToggleWaitlistEntry = (entryId: string) => {
    setSelectedWaitlistEntries((prev) =>
      prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]
    );
  };

  const filteredMentors = mentorsData?.items.filter((mentor) => {
    if (filter === "available") {
      return mentor.oneOnOneInventory > 0 || mentor.groupInventory > 0;
    }
    return true;
  });

  const currentWaitlist =
    waitlistData?.items.filter((e) =>
      waitlistTab === "oneOnOne" ? e.type === "oneOnOne" : e.type === "group"
    ) || [];

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground mt-1">Manage mentor inventory and waitlists</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            variant={filter === "available" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("available")}
          >
            Available
          </Button>
        </div>
      </div>

      {mentorsLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredMentors?.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No mentors found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMentors?.map((mentor) => (
            <Card key={mentor.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {mentor.email || "No user linked"}
                </CardTitle>
                <CardDescription>
                  {mentor.instructorName ? (
                    <Link
                      href={`/instructors/${mentor.instructorSlug}`}
                      target="_blank"
                      className="hover:underline"
                    >
                      {mentor.instructorName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No instructor linked</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">One-on-One Inventory</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(mentor, "oneOnOne", -1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      className="w-16 text-center"
                      value={mentor.oneOnOneInventory}
                      onChange={(e) =>
                        handleSetInventory(mentor, "oneOnOne", parseInt(e.target.value) || 0)
                      }
                      disabled={updateInventoryMutation.isPending}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(mentor, "oneOnOne", 1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Group Inventory</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(mentor, "group", -1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      className="w-16 text-center"
                      value={mentor.groupInventory}
                      onChange={(e) =>
                        handleSetInventory(mentor, "group", parseInt(e.target.value) || 0)
                      }
                      disabled={updateInventoryMutation.isPending}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(mentor, "group", 1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {mentor.instructorSlug && (
                  <div className="flex gap-2 pt-2">
                    <div className="relative group">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={notifyWaitlistMutation.isPending}
                      >
                        {notifyWaitlistMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Notify Waitlist"
                        )}
                      </Button>
                      <div className="absolute top-full left-0 mt-1 hidden group-hover:block z-10 bg-background border rounded-md shadow-lg p-1 min-w-[140px]">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => handleNotifyWaitlist(mentor, "oneOnOne")}
                        >
                          One-on-One
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => handleNotifyWaitlist(mentor, "group")}
                        >
                          Group
                        </Button>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleOpenWaitlist(mentor)}>
                      View Waitlist
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showWaitlistModal} onOpenChange={setShowWaitlistModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Waitlist - {selectedMentor?.instructorName || "Unknown Instructor"}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={waitlistTab} onValueChange={(v) => setWaitlistTab(v as "oneOnOne" | "group")}>
            <TabsList>
              <TabsTrigger value="oneOnOne">One-on-One</TabsTrigger>
              <TabsTrigger value="group">Group</TabsTrigger>
            </TabsList>
            <TabsContent value="oneOnOne">
              {waitlistLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : currentWaitlist.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No waitlist entries
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        markNotifiedMutation.mutate(
                          currentWaitlist.map((e) => e.id)
                        )
                      }
                      disabled={markNotifiedMutation.isPending}
                    >
                      Mark All Notified
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        deleteWaitlistEntriesMutation.mutate(
                          selectedWaitlistEntries
                        )
                      }
                      disabled={selectedWaitlistEntries.length === 0 || deleteWaitlistEntriesMutation.isPending}
                    >
                      Delete Selected
                    </Button>
                  </div>
                  <div className="border rounded-md">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium w-10"></th>
                          <th className="text-left py-2 px-3 font-medium">Email</th>
                          <th className="text-left py-2 px-3 font-medium">Date</th>
                          <th className="text-left py-2 px-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentWaitlist.map((entry) => (
                          <tr key={entry.id} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-3">
                              <Checkbox
                                checked={selectedWaitlistEntries.includes(entry.id)}
                                onCheckedChange={() => handleToggleWaitlistEntry(entry.id)}
                              />
                            </td>
                            <td className="py-2 px-3">{entry.email}</td>
                            <td className="py-2 px-3 text-sm text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={entry.notified ? "default" : "secondary"}>
                                {entry.notified ? "Notified" : "Pending"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="group">
              {waitlistLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : currentWaitlist.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No waitlist entries
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        markNotifiedMutation.mutate(
                          currentWaitlist.map((e) => e.id)
                        )
                      }
                      disabled={markNotifiedMutation.isPending}
                    >
                      Mark All Notified
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        deleteWaitlistEntriesMutation.mutate(
                          selectedWaitlistEntries
                        )
                      }
                      disabled={selectedWaitlistEntries.length === 0 || deleteWaitlistEntriesMutation.isPending}
                    >
                      Delete Selected
                    </Button>
                  </div>
                  <div className="border rounded-md">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium w-10"></th>
                          <th className="text-left py-2 px-3 font-medium">Email</th>
                          <th className="text-left py-2 px-3 font-medium">Date</th>
                          <th className="text-left py-2 px-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentWaitlist.map((entry) => (
                          <tr key={entry.id} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-3">
                              <Checkbox
                                checked={selectedWaitlistEntries.includes(entry.id)}
                                onCheckedChange={() => handleToggleWaitlistEntry(entry.id)}
                              />
                            </td>
                            <td className="py-2 px-3">{entry.email}</td>
                            <td className="py-2 px-3 text-sm text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={entry.notified ? "default" : "secondary"}>
                                {entry.notified ? "Notified" : "Pending"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
