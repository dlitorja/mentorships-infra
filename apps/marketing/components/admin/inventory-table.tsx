"use client";

import { useState } from "react";
import { updateInventory } from "@/lib/supabase-inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Minus, Plus, Bell, Loader2, Trash2, CheckSquare, Square, X } from "lucide-react";
import { toast } from "sonner";
import { useForm, ReactFormExtendedApi } from "@tanstack/react-form";
import { z } from "zod";

interface InstructorInventory {
  id: string;
  instructor_slug: string;
  instructor_name: string;
  one_on_one_inventory: number;
  group_inventory: number;
  has_pricing_one_on_one: boolean;
  has_pricing_group: boolean;
}

interface WaitlistEntry {
  id: number;
  email: string;
  instructor_slug: string;
  mentorship_type: string;
  notified: boolean;
  created_at: string;
}

interface InventoryTableProps {
  initialData: InstructorInventory[];
}

const inventorySchema = z.object({
  oneOnOne: z.number().min(0),
  group: z.number().min(0),
});

type InventoryValues = z.infer<typeof inventorySchema>;

export function InventoryTable({ initialData }: InventoryTableProps) {
  const [inventory, setInventory] = useState<Record<string, InstructorInventory>>(
    Object.fromEntries(initialData.map((i) => [i.instructor_slug, i]))
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [selectedWaitlistInstructor, setSelectedWaitlistInstructor] = useState<{
    slug: string;
    name: string;
    type: string;
  } | null>(null);
  const [waitlistData, setWaitlistData] = useState<WaitlistEntry[]>([]);
  const [loadingWaitlist, setLoadingWaitlist] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // TanStack Form generics use `any` because ReactFormExtendedApi requires 12 type arguments
  // and our InventoryValues type cannot satisfy the complex generic constraints.
  // The form's actual typing is enforced through inventorySchema validation.
  const editForm = useForm<InventoryValues, any, any, any, any, any, any, any, any, any, any, any>({
    defaultValues: {
      oneOnOne: 0,
      group: 0,
    },
    validators: {
      onChange: inventorySchema,
    },
  });

  const handleEdit = (slug: string) => {
    const item = inventory[slug];
    editForm.setFieldValue("oneOnOne", item?.one_on_one_inventory ?? 0);
    editForm.setFieldValue("group", item?.group_inventory ?? 0);
    setEditing(slug);
  };

  const handleSave = async (slug: string) => {
    setSaving(slug);
    try {
      await editForm.handleSubmit();
      const values = editForm.state.values;
      const result = await updateInventory(slug, {
        one_on_one_inventory: values.oneOnOne,
        group_inventory: values.group,
      });

      if (result) {
        setInventory((prev) => ({
          ...prev,
          [slug]: {
            ...prev[slug],
            one_on_one_inventory: values.oneOnOne,
            group_inventory: values.group,
          },
        }));
        toast.success(`Updated inventory for ${inventory[slug].instructor_name}`);
      } else {
        toast.error("Failed to update inventory");
      }
    } catch (error) {
      toast.error("Failed to update inventory");
    } finally {
      setSaving(null);
      setEditing(null);
    }
  };

  const handleCancel = () => {
    setEditing(null);
  };

  const adjustInventory = (type: "oneOnOne" | "group", delta: number) => {
    const current = editForm.state.values[type] ?? 0;
    const newValue = Math.max(0, current + delta);
    editForm.setFieldValue(type, newValue);
  };

  const notifyWaitlist = async (name: string, type: "one-on-one" | "group") => {
    const item = Object.values(inventory).find((i) => i.instructor_name === name);
    if (!item) return;

    try {
      const response = await fetch("/api/admin/waitlist-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorSlug: item.instructor_slug, type }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(
          <div>
            <p className="font-medium">Notifications Sent</p>
            <p className="text-sm">{data.message}</p>
            {data.notifiedEmails?.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                <p>Emails notified:</p>
                <ul className="list-disc list-inside">
                  {data.notifiedEmails.map((email: string, i: number) => (
                    <li key={i}>{email}</li>
                  ))}
                </ul>
                {data.totalEmails > data.notifiedEmails.length && (
                  <p>+{data.totalEmails - data.notifiedEmails.length} more</p>
                )}
              </div>
            )}
          </div>
        );
      } else {
        toast.error(data.error || "Failed to send notifications");
      }
    } catch (error) {
      toast.error("Error sending notifications");
    }
  };

  const getStatusColor = (count: number) => {
    if (count === 0) return "text-red-600";
    if (count <= 2) return "text-yellow-600";
    return "text-green-600";
  };

  const openWaitlistModal = async (name: string, type: "one-on-one" | "group") => {
    const item = Object.values(inventory).find((i) => i.instructor_name === name);
    if (!item) return;

    setSelectedWaitlistInstructor({ slug: item.instructor_slug, name: item.instructor_name, type });
    setLoadingWaitlist(true);
    setSelectedEmails(new Set());
    setShowWaitlistModal(true);

    try {
      const response = await fetch(
        `/api/admin/waitlist?instructor=${item.instructor_slug}&type=${type}`
      );
      const data = await response.json();
      if (data.entries) {
        setWaitlistData(data.entries);
      } else {
        setWaitlistData([]);
      }
    } catch (error) {
      console.error("Error fetching waitlist:", error);
      toast.error("Failed to fetch waitlist. Please try again.");
      setWaitlistData([]);
    } finally {
      setLoadingWaitlist(false);
    }
  };

  const closeWaitlistModal = () => {
    setShowWaitlistModal(false);
    setSelectedWaitlistInstructor(null);
    setWaitlistData([]);
    setSelectedEmails(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedEmails.size === waitlistData.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(waitlistData.map((e) => e.id)));
    }
  };

  const toggleEmail = (id: number) => {
    const newSelected = new Set(selectedEmails);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedEmails(newSelected);
  };

  const deleteSelected = async () => {
    if (selectedEmails.size === 0) return;

    setDeleting(true);
    try {
      const response = await fetch("/api/admin/waitlist-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedEmails) }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success(`Deleted ${data.deletedCount} entries`);
        setWaitlistData((prev) => prev.filter((e) => !selectedEmails.has(e.id)));
        setSelectedEmails(new Set());
      } else {
        toast.error(data.error || "Failed to delete");
      }
    } catch (error) {
      toast.error("Error deleting entries");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.values(inventory).map((item) => {
          const isEditing = editing === item.instructor_slug;

          return (
            <Card key={item.id} className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{item.instructor_name}</span>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleCancel}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSave(item.instructor_slug)}
                        disabled={saving === item.instructor_slug}
                      >
                        {saving === item.instructor_slug && (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        )}
                        Save
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(item.instructor_slug)}
                    >
                      Edit
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-3">
                  {item.has_pricing_one_on_one && (
                    <div className="flex flex-col items-center p-2 bg-muted/20 rounded">
                      <span className="text-xs font-medium">1-on-1</span>
                      {isEditing ? (
                        <editForm.Subscribe
                          selector={(state) => state.values.oneOnOne}
                        >
                          {(oneOnOne) => (
                            <>
                              <span className={`text-xl font-bold ${getStatusColor(oneOnOne)}`}>
                                {oneOnOne}
                              </span>
                              <div className="flex items-center gap-1 mt-1">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustInventory("oneOnOne", -1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <Input
                                  type="number"
                                  value={oneOnOne}
                                  onChange={(e) =>
                                    editForm.setFieldValue("oneOnOne", parseInt(e.target.value) || 0)
                                  }
                                  className="h-6 w-10 text-center text-xs"
                                  min={0}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustInventory("oneOnOne", 1)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            </>
                          )}
                        </editForm.Subscribe>
                      ) : (
                        <>
                          <span className={`text-xl font-bold ${getStatusColor(item.one_on_one_inventory)}`}>
                            {item.one_on_one_inventory}
                          </span>
                          {item.one_on_one_inventory > 0 && (
                            <div className="flex flex-col gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => notifyWaitlist(item.instructor_name, "one-on-one")}
                              >
                                <Bell className="h-3 w-3 mr-1" />
                                Notify Waitlist
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs text-muted-foreground"
                                onClick={() => openWaitlistModal(item.instructor_name, "one-on-one")}
                              >
                                View Waitlist
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {item.has_pricing_group && (
                    <div className="flex flex-col items-center p-2 bg-muted/20 rounded">
                      <span className="text-xs font-medium">Group</span>
                      {isEditing ? (
                        <editForm.Subscribe
                          selector={(state) => state.values.group}
                        >
                          {(group) => (
                            <>
                              <span className={`text-xl font-bold ${getStatusColor(group)}`}>
                                {group}
                              </span>
                              <div className="flex items-center gap-1 mt-1">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustInventory("group", -1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <Input
                                  type="number"
                                  value={group}
                                  onChange={(e) =>
                                    editForm.setFieldValue("group", parseInt(e.target.value) || 0)
                                  }
                                  className="h-6 w-10 text-center text-xs"
                                  min={0}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustInventory("group", 1)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            </>
                          )}
                        </editForm.Subscribe>
                      ) : (
                        <>
                          <span className={`text-xl font-bold ${getStatusColor(item.group_inventory)}`}>
                            {item.group_inventory}
                          </span>
                          {item.group_inventory > 0 && (
                            <div className="flex flex-col gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => notifyWaitlist(item.instructor_name, "group")}
                              >
                                <Bell className="h-3 w-3 mr-1" />
                                Notify Waitlist
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs text-muted-foreground"
                                onClick={() => openWaitlistModal(item.instructor_name, "group")}
                              >
                                View Waitlist
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {!item.has_pricing_one_on_one && !item.has_pricing_group && (
                    <p className="text-sm text-muted-foreground col-span-2 text-center">
                      No mentorship types configured for this instructor.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {Object.values(inventory).length === 0 && (
          <Card className="col-span-2">
            <CardContent className="py-8 text-center text-muted-foreground">
              No instructors found.
            </CardContent>
          </Card>
        )}
      </div>

      {showWaitlistModal && selectedWaitlistInstructor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <CardHeader className="pb-2 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Waitlist: {selectedWaitlistInstructor.name}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground capitalize">
                    {selectedWaitlistInstructor.type.replace("-", " ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={closeWaitlistModal}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {loadingWaitlist ? (
                <div className="p-8 text-center text-muted-foreground">
                  Loading...
                </div>
              ) : waitlistData.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No one on the waitlist yet.
                </div>
              ) : (
                <div className="divide-y">
                  <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={toggleSelectAll}
                    >
                      {selectedEmails.size === waitlistData.length ? (
                        <CheckSquare className="h-4 w-4 mr-1" />
                      ) : (
                        <Square className="h-4 w-4 mr-1" />
                      )}
                      Select All
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={deleteSelected}
                      disabled={selectedEmails.size === 0 || deleting}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete Selected ({selectedEmails.size})
                    </Button>
                  </div>
                  {waitlistData.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20"
                    >
                      <button
                        onClick={() => toggleEmail(entry.id)}
                        className="flex-shrink-0"
                      >
                        {selectedEmails.has(entry.id) ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{entry.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
