'use client';

import { Button } from "@/components/ui/button";
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
  return (
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
                    onClick={() => onDelete(t.id)}
                    disabled={deleteIsPending}
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
  );
}
