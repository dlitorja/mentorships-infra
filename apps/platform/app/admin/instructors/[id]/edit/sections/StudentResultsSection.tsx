'use client';

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import type { StudentResult } from "../types";

interface StudentResultsSectionProps {
  studentResults: StudentResult[];
  setActiveTab: (tab: string) => void;
  onAddClick: () => void;
  onDelete: (id: string) => void;
  deleteIsPending: boolean;
}

export function StudentResultsSection({
  studentResults,
  setActiveTab,
  onAddClick,
  onDelete,
  deleteIsPending,
}: StudentResultsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Student Results</CardTitle>
            <CardDescription>Before/after images from students</CardDescription>
          </div>
          <Button onClick={onAddClick}>
            <Plus className="mr-2 h-4 w-4" />
            Add Result
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {studentResults.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No student results yet</p>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {studentResults.map((r) => (
              <div key={r.id} className="relative group h-32">
                {r.imageUrl && (
                  <Image
                    src={r.imageUrl}
                    alt="Student result"
                    fill
                    sizes="(max-width: 768px) 25vw, 15vw"
                    unoptimized
                    className="object-cover rounded"
                  />
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(r.id)}
                    disabled={deleteIsPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {r.studentName && (
                  <p className="text-xs text-center mt-1">{r.studentName}</p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-4">
          <Button variant="outline" onClick={() => setActiveTab("testimonials")}>Back</Button>
        </div>
      </CardContent>
    </Card>
  );
}
