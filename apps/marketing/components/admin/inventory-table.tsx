"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Minus, Bell, X } from "lucide-react";
import { toast } from "sonner";
import {
  useInventoryInstructors,
  useUpdateInventory,
  useMarkNotifiedByInstructor,
  useWaitlistForInstructor,
  useRemoveMultipleFromWaitlist,
  type InventoryInstructor,
  type InventoryWaitlistEntry,
} from "@/lib/queries/convex/use-inventory";
import type { Id } from "@/convex/_generated/dataModel";
import { instructors as instructorConfig } from "@/lib/instructors";

/**
 * PR 6: marketing /admin/inventory page rewritten to read + write
 * Convex. Replaces the Supabase-backed
 * `getAllInstructorsWithInventory` + `getWaitlistCounts` join (the
 * source of the `operator does not exist: text = uuid` 500 that
 * broke this page) and the legacy fetch-based mutations
 * (`/api/admin/waitlist`, `/api/admin/waitlist-notify`,
 * `/api/admin/waitlist-delete`, `/api/admin/waitlist-csv`).
 *
 * Source-of-truth for inventory + waitlist: Convex.
 * `apps/marketing/lib/instructors.ts` keeps its role as marketing
 * copy (offer labels, `has_pricing_*` flags) and is combined with the
 * Convex row by `slug` to render the card.
 *
 * UX shape mirrors `apps/web/app/admin/inventory/page.tsx` (card grid,
 * +/- buttons per inventory type, View Waitlist modal with checkboxes,
 * Mark All Notified) with two marketing-specific adjustments:
 *   - Single-type modal per card (the existing marketing modal pattern
 *     used `View Waitlist (One-on-One)` / `View Waitlist (Group)`
 *     buttons that opened a modal scoped to one type). The two-tabs
 *     `apps/web` pattern would require adding `Tabs` + `Checkbox` UI
 *     components to marketing's local `components/ui/` and is not in
 *     this PR's scope.
 *   - Per-type buttons (Notify / View) rendered conditionally
 *     against `has_pricing_*` so a group-only instructor still
 *     surfaces the Group controls. Notify buttons are GUARDED
 *     against zero inventory — sending "A spot has opened up"
 *     emails while the corresponding inventory is zero is a
 *     Greptile P1. Modal "Mark All Notified" is STATE-ONLY
 *     (calls `markNotifiedByInstructor`) so admins can record that
 *     subscribers were already contacted out-of-band; the per-card
 *     Notify buttons are the email-send action.
 */

type MentorshipType = "oneOnOne" | "group";

function getInventoryColor(count: number | undefined): string {
  const value = count ?? 0;
  if (value === 0) return "text-red-600";
  if (value <= 2) return "text-yellow-600";
  return "text-green-600";
}

function findStaticConfig(slug: string | null | undefined) {
  if (!slug) return null;
  return instructorConfig.find((i) => i.slug === slug) ?? null;
}

export function InventoryTable() {
  const [filter, setFilter] = useState<"all" | "available">("all");
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [selectedInstructor, setSelectedInstructor] = useState<InventoryInstructor | null>(null);
  const [modalType, setModalType] = useState<MentorshipType>("oneOnOne");
  const [selectedWaitlistEntries, setSelectedWaitlistEntries] = useState<Id<"marketingWaitlist">[]>([]);

  const { data, isLoading, error } = useInventoryInstructors();
  const updateInventory = useUpdateInventory();
  const notifyQueueMutation = useMutation({
    mutationFn: async (vars: { instructorSlug: string; type: MentorshipType }) => {
      // The Inngest worker validates `type` against ["one-on-one",
      // "group"] (see
      // apps/marketing/inngest/functions/waitlist-notifications.ts
      // line 71) so we map our internal `oneOnOne`/`group` enum to
      // the wire format the worker expects. The worker reads
      // unnotified entries, sends Resend emails, then marks
      // notified — we deliberately do NOT call
      // `markNotifiedByInstructor` from the per-card notify button
      // because doing so would race the worker's eligibility read
      // (prior-0/1 on PR #866). The modal "Mark All Notified"
      // button, in contrast, IS the state-only mutation — see the
      // `handleMarkAllNotified` handler below.
      const wireType = vars.type === "oneOnOne" ? "one-on-one" : "group";
      const res = await fetch("/api/admin/waitlist-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorSlug: vars.instructorSlug, type: wireType }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json().catch(() => ({}));
    },
  });
  const markNotifiedMutation = useMarkNotifiedByInstructor();
  const notifyPending = notifyQueueMutation.isPending;
  const removeMultipleMutation = useRemoveMultipleFromWaitlist();

  const waitlistEntries = useWaitlistForInstructor(
    selectedInstructor?.slug ?? null,
    modalType,
    showWaitlistModal && !!selectedInstructor?.slug,
  );

  const rows = (data as InventoryInstructor[] | undefined) ?? [];

  const filteredRows = rows.filter((inst) => {
    if (filter === "available") {
      return (inst.oneOnOneInventory ?? 0) > 0 || (inst.groupInventory ?? 0) > 0;
    }
    return true;
  });

  const handleAdjustInventory = (
    instructor: InventoryInstructor,
    type: MentorshipType,
    delta: number,
  ) => {
    // Reads the inventory from the React closure rather than the live
    // Convex cache so two rapid +/- clicks send absolute values that
    // compose against each other. Greptile flagged this as a "last
    // write wins" race window — addressing it cleanly requires an
    // atomic increment/decrement Convex function, which §4d rejects
    // ("no new Convex code"). Optimistic `onMutate` in
    // `useUpdateInventory` reduces the visual revert window but the
    // server-side race remains. Plan doc §4d Known limitations #4.
    const current = type === "oneOnOne"
      ? (instructor.oneOnOneInventory ?? 0)
      : (instructor.groupInventory ?? 0);
    const next = current + delta;
    if (next < 0) return;

    updateInventory.mutate(
      {
        id: instructor._id,
        [type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory"]: next,
      },
      {
        onError: (err) => {
          toast.error(`Inventory update failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        },
      },
    );
  };

  const handleSetInventory = (
    instructor: InventoryInstructor,
    type: MentorshipType,
    value: number,
  ) => {
    if (value < 0 || Number.isNaN(value)) return;
    updateInventory.mutate(
      {
        id: instructor._id,
        [type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory"]: value,
      },
      {
        onError: (err) => {
          toast.error(`Inventory update failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        },
      },
    );
  };

  const handleMarkNotified = (slug: string | null | undefined, type: MentorshipType) => {
    if (!slug) return;
    notifyQueueMutation.mutate(
      { instructorSlug: slug, type },
      {
        onError: (err) => {
          toast.error(
            `Queue notify failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        },
        onSuccess: () => {
          toast.success(
            `Queued ${type === "oneOnOne" ? "1-on-1" : "group"} waitlist notifications`,
          );
        },
      },
    );
  };

  const handleOpenWaitlist = (instructor: InventoryInstructor, type: MentorshipType) => {
    setSelectedInstructor(instructor);
    setModalType(type);
    setSelectedWaitlistEntries([]);
    setShowWaitlistModal(true);
  };

  const handleCloseWaitlist = () => {
    setShowWaitlistModal(false);
    setSelectedWaitlistEntries([]);
  };

  const handleToggleWaitlistEntry = (entryId: Id<"marketingWaitlist">) => {
    setSelectedWaitlistEntries((prev) =>
      prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId],
    );
  };

  const handleDeleteSelected = () => {
    if (!selectedInstructor?.slug || selectedWaitlistEntries.length === 0) return;
    removeMultipleMutation.mutate(
      { ids: selectedWaitlistEntries },
      {
        onError: (err) => {
          toast.error(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        },
        onSuccess: (result) => {
          const removed = (result as { count?: number } | undefined)?.count ?? selectedWaitlistEntries.length;
          toast.success(`Deleted ${removed} entries`);
          setSelectedWaitlistEntries([]);
        },
      },
    );
  };

  const handleMarkAllNotified = () => {
    if (!selectedInstructor?.slug) return;
    // State-only: sets `notifiedAt` on every entry for this
    // (instructor, type). Use this when an admin has already
    // contacted subscribers out-of-band (e.g. personal email) and
    // wants to mark the rows as resolved without triggering the
    // Inngest notify job. The per-card "Notify X Waitlist" buttons
    // are the email-send action — that path is the one that queues
    // /api/admin/waitlist-notify. Greptile P1 on PR #866: keeping
    // the modal action state-only avoids surprising admins with
    // duplicate availability emails.
    markNotifiedMutation.mutate(
      { instructorSlug: selectedInstructor.slug, mentorshipType: modalType },
      {
        onError: (err) => {
          toast.error(
            `Mark notified failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        },
        onSuccess: (result) => {
          const updated = (result as { count?: number } | undefined)?.count;
          toast.success(
            updated != null
              ? `Marked ${updated} entries as notified`
              : "Marked entries as notified",
          );
        },
      },
    );
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-destructive">Failed to load instructors.</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage instructor inventory and waitlists
          </p>
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
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No instructors found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRows.map((instructor) => (
            <InstructorCard
              key={instructor._id}
              instructor={instructor}
              pending={updateInventory.isPending}
notifyPending={notifyPending}
              onAdjust={handleAdjustInventory}
              onSet={handleSetInventory}
              onMarkNotified={handleMarkNotified}
              onOpenWaitlist={handleOpenWaitlist}
            />
          ))}
        </div>
      )}

      <Dialog open={showWaitlistModal} onOpenChange={setShowWaitlistModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Waitlist — {selectedInstructor?.name || selectedInstructor?.slug || "Unknown"}
              {" "}
              <span className="text-muted-foreground text-sm font-normal ml-2">
                ({modalType === "oneOnOne" ? "1-on-1" : "Group"})
              </span>
            </DialogTitle>
          </DialogHeader>
          <WaitlistModalBody
            entries={(waitlistEntries.data as InventoryWaitlistEntry[] | undefined) ?? []}
            loading={waitlistEntries.isLoading}
            error={waitlistEntries.error}
            selectedIds={selectedWaitlistEntries}
            removePending={removeMultipleMutation.isPending}
            notifyPending={markNotifiedMutation.isPending}
            onToggle={handleToggleWaitlistEntry}
            onDelete={handleDeleteSelected}
            onMarkAll={handleMarkAllNotified}
            onClose={handleCloseWaitlist}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function InstructorCard({
  instructor,
  pending,
  notifyPending,
  onAdjust,
  onSet,
  onMarkNotified,
  onOpenWaitlist,
}: {
  instructor: InventoryInstructor;
  pending: boolean;
  notifyPending: boolean;
  onAdjust: (instructor: InventoryInstructor, type: MentorshipType, delta: number) => void;
  onSet: (instructor: InventoryInstructor, type: MentorshipType, value: number) => void;
  onMarkNotified: (slug: string | null | undefined, type: MentorshipType) => void;
  onOpenWaitlist: (instructor: InventoryInstructor, type: MentorshipType) => void;
}) {
  const staticConfig = findStaticConfig(instructor.slug);
  const hasOneOnOne = staticConfig?.offers.some(
    (o) => o.kind === "oneOnOne" && o.active !== false,
  );
  const hasGroup = staticConfig?.offers.some(
    (o) => o.kind === "group" && o.active !== false,
  );

  return (
    <Card>
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
        {hasOneOnOne && (
          <InventoryRow
            label="One-on-One"
            value={instructor.oneOnOneInventory ?? 0}
            disabled={pending}
            onAdjust={(delta) => onAdjust(instructor, "oneOnOne", delta)}
            onSet={(value) => onSet(instructor, "oneOnOne", value)}
          />
        )}
        {hasGroup && (
          <InventoryRow
            label="Group"
            value={instructor.groupInventory ?? 0}
            disabled={pending}
            onAdjust={(delta) => onAdjust(instructor, "group", delta)}
            onSet={(value) => onSet(instructor, "group", value)}
          />
        )}
        {!hasOneOnOne && !hasGroup && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No mentorship types configured for this instructor.
          </p>
        )}
        {instructor.slug && (
          <div className="flex flex-wrap gap-2 pt-2">
            {hasOneOnOne && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMarkNotified(instructor.slug, "oneOnOne")}
                disabled={
                  notifyPending || (instructor.oneOnOneInventory ?? 0) <= 0
                }
                title={
                  (instructor.oneOnOneInventory ?? 0) <= 0
                    ? "Cannot send availability emails — 1-on-1 inventory is zero"
                    : "Send the Inngest availability-email job for unnotified 1-on-1 waitlist entries"
                }
              >
                {notifyPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Bell className="h-3 w-3 mr-1" />
                    Notify 1-on-1 Waitlist
                  </>
                )}
              </Button>
            )}
            {hasGroup && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMarkNotified(instructor.slug, "group")}
                disabled={notifyPending || (instructor.groupInventory ?? 0) <= 0}
                title={
                  (instructor.groupInventory ?? 0) <= 0
                    ? "Cannot send availability emails — group inventory is zero"
                    : "Send the Inngest availability-email job for unnotified group waitlist entries"
                }
              >
                {notifyPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Bell className="h-3 w-3 mr-1" />
                    Notify Group Waitlist
                  </>
                )}
              </Button>
            )}
            {hasOneOnOne && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenWaitlist(instructor, "oneOnOne")}
              >
                View 1-on-1 Waitlist
              </Button>
            )}
            {hasGroup && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenWaitlist(instructor, "group")}
              >
                View Group Waitlist
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InventoryRow({
  label,
  value,
  disabled,
  onAdjust,
  onSet,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label} Inventory</Label>
      <div className="flex items-center gap-2 mt-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onAdjust(-1)}
          disabled={disabled}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          className="w-16 text-center"
          value={value}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            if (!Number.isNaN(parsed)) onSet(parsed);
          }}
          disabled={disabled}
          min={0}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onAdjust(1)}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <span className={`text-sm font-semibold ml-2 ${getInventoryColor(value)}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function WaitlistModalBody({
  entries,
  loading,
  error,
  selectedIds,
  removePending,
  notifyPending,
  onToggle,
  onDelete,
  onMarkAll,
  onClose,
}: {
  entries: InventoryWaitlistEntry[];
  loading: boolean;
  error: unknown;
  selectedIds: Id<"marketingWaitlist">[];
  removePending: boolean;
  notifyPending: boolean;
  onToggle: (entryId: Id<"marketingWaitlist">) => void;
  onDelete: () => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4 flex-1 min-h-0 flex flex-col">
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onMarkAll}
          disabled={loading || notifyPending || entries.length === 0}
          title="Mark every entry as notified without sending an email — use this when subscribers were already contacted out-of-band"
        >
          Mark All Notified
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={selectedIds.length === 0 || removePending}
        >
          Delete Selected ({selectedIds.length})
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-destructive" role="alert">
          <p>Failed to load waitlist entries.</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No waitlist entries
        </div>
      ) : (
        <div className="border rounded-md overflow-auto max-h-[55vh]">
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-medium w-10"></th>
                <th className="text-left py-2 px-3 font-medium">Email</th>
                <th className="text-left py-2 px-3 font-medium">Date</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={String(entry._id)} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.includes(entry._id)}
                      onChange={() => onToggle(entry._id)}
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
      )}
    </div>
  );
}
