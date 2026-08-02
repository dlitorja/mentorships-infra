'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InstructorFormData } from "../types";

interface InventorySectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  setActiveTab: (tab: string) => void;
}

export function InventorySection({ formData, setFormData, setActiveTab }: InventorySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory & Bookings</CardTitle>
        <CardDescription>Configure session availability and booking settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="oneOnOneInventory">One-on-One Inventory</Label>
            <Input
              id="oneOnOneInventory"
              type="number"
              min="0"
              max="999"
              value={formData.oneOnOneInventory}
              onChange={(e) => {
                const parsed = parseInt(e.target.value);
                const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(999, parsed));
                setFormData((prev) => ({ ...prev, oneOnOneInventory: clamped }));
              }}
            />
            <p className="text-sm text-muted-foreground mt-1">Available 1-on-1 session slots</p>
          </div>
          <div>
            <Label htmlFor="groupInventory">Group Inventory</Label>
            <Input
              id="groupInventory"
              type="number"
              min="0"
              max="999"
              value={formData.groupInventory}
              onChange={(e) => {
                const parsed = parseInt(e.target.value);
                const clamped = isNaN(parsed) ? 0 : Math.max(0, Math.min(999, parsed));
                setFormData((prev) => ({ ...prev, groupInventory: clamped }));
              }}
            />
            <p className="text-sm text-muted-foreground mt-1">Available group session slots</p>
          </div>
          <div>
            <Label htmlFor="maxActiveStudents">Max Active Students</Label>
            <Input
              id="maxActiveStudents"
              type="number"
              min="1"
              max="100"
              value={formData.maxActiveStudents}
              onChange={(e) => {
                const parsed = parseInt(e.target.value);
                const clamped = isNaN(parsed) ? 10 : Math.max(1, Math.min(100, parsed));
                setFormData((prev) => ({ ...prev, maxActiveStudents: clamped }));
              }}
            />
            <p className="text-sm text-muted-foreground mt-1">Maximum concurrent students</p>
          </div>
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={() => setActiveTab("social")}>Back</Button>
          <Button onClick={() => setActiveTab("testimonials")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
