'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import type { Testimonial } from "../types";

interface TestimonialsSectionProps {
  testimonials: Testimonial[];
  setActiveTab: (tab: string) => void;
  onAddClick: () => void;
  onDelete: (id: string) => void;
  deleteIsPending: boolean;
}

export function TestimonialsSection({
  testimonials,
  setActiveTab,
  onAddClick,
  onDelete,
  deleteIsPending,
}: TestimonialsSectionProps) {
  // Deleting here is immediate (no save step), so ask first: the previous
  // behaviour removed public content on a single click with no undo.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  return (
    <>
      <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Testimonials</CardTitle>
            <CardDescription>Manage testimonials for this instructor</CardDescription>
          </div>
          <Button onClick={onAddClick}>
            <Plus className="mr-2 h-4 w-4" />
            Add Testimonial
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {testimonials.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No testimonials yet</p>
        ) : (
          <div className="space-y-4">
            {testimonials.map((t) => (
              <div key={t.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t.text}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPendingDelete({ id: t.id, label: t.name || "this testimonial" })
                    }
                    disabled={deleteIsPending}
                    aria-label={`Delete testimonial from ${t.name || "this student"}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-4">
          <Button variant="outline" onClick={() => setActiveTab("social")}>Back</Button>
          <Button onClick={() => setActiveTab("results")}>Next</Button>
        </div>
      </CardContent>
    </Card>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this testimonial?</DialogTitle>
            <DialogDescription>
              The testimonial from {pendingDelete?.label} is removed from the instructor&apos;s
              public profile immediately. Changes here are not part of the form&apos;s Save, and
              there is no undo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete testimonial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
