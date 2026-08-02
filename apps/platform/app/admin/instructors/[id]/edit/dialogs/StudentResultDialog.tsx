'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { ImageUploadField } from "@/components/admin/image-upload-field";

interface StudentResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: { imageUrl: string; imageUploadPath: string; studentName: string };
  onFormChange: (values: { imageUrl: string; imageUploadPath: string; studentName: string }) => void;
  onAdd: () => void;
  isPending: boolean;
  instructorId: string;
}

export function StudentResultDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onAdd,
  isPending,
  instructorId,
}: StudentResultDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Student Result</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ImageUploadField
            label="Result Image"
            value={form.imageUrl}
            onChange={(url) => onFormChange({ ...form, imageUrl: url, imageUploadPath: "" })}
            onUploadComplete={(_url, path) => onFormChange({ ...form, imageUploadPath: path })}
            instructorId={instructorId}
            type="result"
            enableCrop
          />
          <div>
            <Label>Student Name (optional)</Label>
            <Input
              value={form.studentName}
              onChange={(e) => onFormChange({ ...form, studentName: e.target.value })}
              placeholder="Student name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onAdd}
            disabled={!form.imageUrl || isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
