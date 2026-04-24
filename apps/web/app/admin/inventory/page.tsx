"use client";

import React, { useState } from "react";
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
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Minus } from "lucide-react";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useAdminInstructors, useUpdateInventory } from "@/lib/queries/convex/use-instructors";
import { useWaitlistForInstructor, useMarkNotifiedByInstructor, useRemoveMultipleFromWaitlist } from "@/lib/queries/convex/use-waitlist";

type InstructorWithInventory = {
  _id: Id<"instructors">;
  userId?: string;
  name?: string | null;
  slug?: string | null;
  email?: string | null;
  maxActiveStudents?: number;
  oneOnOneInventory?: number;
  groupInventory?: number;
  deletedAt?: number | null;
};

type WaitlistEntry = {
  _id: Id<"marketingWaitlist">;
  email: string;
  mentorshipType: "oneOnOne" | "group";
  notifiedAt: number | null;
  createdAt: number;
};

export default function InventoryPage() {
  const [filter, setFilter] = useState<"all" | "available">("all");
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [selectedInstructor, setSelectedInstructor] = useState<InstructorWithInventory | null>(null);
  const [waitlistTab, setWaitlistTab] = useState<"oneOnOne" | "group">("oneOnOne");
  const [selectedWaitlistEntries, setSelectedWaitlistEntries] = useState<string[]>([]);

  const { data: instructorsData, isLoading, refetch } = useAdminInstructors();

  const waitlistQueryType = waitlistTab === "oneOnOne" ? "oneOnOne" : "group";
  const {
    data: waitlistEntries,
    isLoading: waitlistLoading,
    refetch: refetchWaitlist,
  } = useWaitlistForInstructor(
    selectedInstructor?.slug ?? "",
    waitlistQueryType
  );

  const updateInventoryMutation = useUpdateInventory();
  const markNotifiedByInstructorMutation = useMarkNotifiedByInstructor();
  const removeMultipleFromWaitlistMutation = useRemoveMultipleFromWaitlist();

  const handleAdjustInventory = (
    instructor: InstructorWithInventory,
    type: "oneOnOne" | "group",
    delta: number
  ) => {
    const currentValue = type === "oneOnOne" ? (instructor.oneOnOneInventory ?? 0) : (instructor.groupInventory ?? 0);
    const newValue = currentValue + delta;
    if (newValue < 0) return;

    updateInventoryMutation.mutate({
      id: instructor._id,
      [type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory"]: newValue,
    });
  };

  const handleSetInventory = (
    instructor: InstructorWithInventory,
    type: "oneOnOne" | "group",
    value: number
  ) => {
    if (value < 0) return;

    updateInventoryMutation.mutate({
      id: instructor._id,
      [type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory"]: value,
    });
  };

  const handleNotifyWaitlist = (instructor: InstructorWithInventory, type: "oneOnOne" | "group") => {
    if (!instructor.slug) return;
    markNotifiedByInstructorMutation.mutate({
      instructorSlug: instructor.slug,
      mentorshipType: type,
    });
  };

  const handleOpenWaitlist = (instructor: InstructorWithInventory) => {
    setSelectedInstructor(instructor);
    setSelectedWaitlistEntries([]);
    setShowWaitlistModal(true);
  };

  const handleToggleWaitlistEntry = (entryId: string) => {
    setSelectedWaitlistEntries((prev) =>
      prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]
    );
  };

  const filteredInstructors = instructorsData?.filter((inst) => {
    if (filter === "available") {
      return (inst.oneOnOneInventory ?? 0) > 0 || (inst.groupInventory ?? 0) > 0;
    }
    return true;
  }) ?? [];

  const currentWaitlist = waitlistEntries?.filter((e) =>
    waitlistTab === "oneOnOne" ? e.mentorshipType === "oneOnOne" : e.mentorshipType === "group"
  ) ?? [];

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground mt-1">Manage instructor inventory and waitlists</p>
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

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredInstructors.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No instructors found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredInstructors.map((instructor) => (
            <Card key={instructor._id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {instructor.name || instructor.email || instructor.userId || "Unnamed"}
                </CardTitle>
                <CardDescription>
                  {instructor.slug ? (
                    <Link
                      href={`/instructors/${instructor.slug}`}
                      target="_blank"
                      className="hover:underline"
                    >
                      {instructor.name || instructor.slug}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No profile slug</span>
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
                      onClick={() => handleAdjustInventory(instructor, "oneOnOne", -1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      className="w-16 text-center"
                      value={instructor.oneOnOneInventory}
                      onChange={(e) =>
                        handleSetInventory(instructor, "oneOnOne", parseInt(e.target.value) || 0)
                      }
                      disabled={updateInventoryMutation.isPending}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(instructor, "oneOnOne", 1)}
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
                      onClick={() => handleAdjustInventory(instructor, "group", -1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      className="w-16 text-center"
                      value={instructor.groupInventory}
                      onChange={(e) =>
                        handleSetInventory(instructor, "group", parseInt(e.target.value) || 0)
                      }
                      disabled={updateInventoryMutation.isPending}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleAdjustInventory(instructor, "group", 1)}
                      disabled={updateInventoryMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {instructor.slug && (
                  <div className="flex gap-2 pt-2">
                    <div className="relative group">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={markNotifiedByInstructorMutation.isPending}
                      >
                        {markNotifiedByInstructorMutation.isPending ? (
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
                          onClick={() => handleNotifyWaitlist(instructor, "oneOnOne")}
                        >
                          One-on-One
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => handleNotifyWaitlist(instructor, "group")}
                        >
                          Group
                        </Button>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleOpenWaitlist(instructor)}>
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
              Waitlist - {selectedInstructor?.name || selectedInstructor?.slug || "Unknown Instructor"}
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
                        markNotifiedByInstructorMutation.mutate({
                          instructorSlug: selectedInstructor?.slug ?? "",
                          mentorshipType: "oneOnOne",
                        })
                      }
                      disabled={markNotifiedByInstructorMutation.isPending}
                    >
                      Mark All Notified
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        removeMultipleFromWaitlistMutation.mutate({
                          ids: selectedWaitlistEntries.map((id) => id as Id<"marketingWaitlist">),
                        })
                      }
                      disabled={selectedWaitlistEntries.length === 0 || removeMultipleFromWaitlistMutation.isPending}
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
                          <tr key={String(entry._id)} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-3">
                              <Checkbox
                                checked={selectedWaitlistEntries.includes(String(entry._id))}
                                onCheckedChange={() => handleToggleWaitlistEntry(String(entry._id))}
                              />
                            </td>
                            <td className="py-2 px-3">{entry.email}</td>
                            <td className="py-2 px-3 text-sm text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={entry.notifiedAt ? "default" : "secondary"}>
                                {entry.notifiedAt ? "Notified" : "Pending"}
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
                        markNotifiedByInstructorMutation.mutate({
                          instructorSlug: selectedInstructor?.slug ?? "",
                          mentorshipType: "group",
                        })
                      }
                      disabled={markNotifiedByInstructorMutation.isPending}
                    >
                      Mark All Notified
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        removeMultipleFromWaitlistMutation.mutate({
                          ids: selectedWaitlistEntries.map((id) => id as Id<"marketingWaitlist">),
                        })
                      }
                      disabled={selectedWaitlistEntries.length === 0 || removeMultipleFromWaitlistMutation.isPending}
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
                          <tr key={String(entry._id)} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-3">
                              <Checkbox
                                checked={selectedWaitlistEntries.includes(String(entry._id))}
                                onCheckedChange={() => handleToggleWaitlistEntry(String(entry._id))}
                              />
                            </td>
                            <td className="py-2 px-3">{entry.email}</td>
                            <td className="py-2 px-3 text-sm text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={entry.notifiedAt ? "default" : "secondary"}>
                                {entry.notifiedAt ? "Notified" : "Pending"}
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