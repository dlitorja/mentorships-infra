'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface TestimonialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: { name: string; text: string };
  onFormChange: (values: { name: string; text: string }) => void;
  onAdd: () => void;
  isPending: boolean;
}

export function TestimonialDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onAdd,
  isPending,
}: TestimonialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Testimonial</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => onFormChange({ ...form, name: e.target.value })}
              placeholder="Student name"
            />
          </div>
          <div>
            <Label>Testimonial</Label>
            <Textarea
              value={form.text}
              onChange={(e) => onFormChange({ ...form, text: e.target.value })}
              placeholder="What they said..."
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onAdd}
            disabled={!form.name || !form.text || isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
