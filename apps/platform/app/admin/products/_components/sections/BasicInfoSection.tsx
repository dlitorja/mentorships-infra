'use client';

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import type { Instructor } from "../types";

interface BasicInfoSectionProps {
  form: any;
  instructors: Instructor[];
  isLoadingInstructors: boolean;
  isSubmitting: boolean;
}

export function BasicInfoSection({
  form,
  instructors,
  isLoadingInstructors,
  isSubmitting,
}: BasicInfoSectionProps) {
  return (
    <div className="space-y-4">
      <form.Field name="instructorId">
        {(field: any) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Instructor *</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v);
                // Mark as touched to control error display
                field.handleBlur();
              }}
              disabled={isLoadingInstructors}
              // Mark field as touched when menu closes
            >
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Select an instructor" />
              </SelectTrigger>
              <SelectContent>
                {instructors.map((instructor) => (
                  <SelectItem key={instructor.id} value={instructor.id}>
                    {instructor.name || instructor.email || instructor.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.isTouched && (!field.state.value || field.state.value.length === 0) && (
              <p className="text-sm text-red-600">Instructor is required.</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="title">
        {(field: any) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Product Title *</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="e.g., 4-Session Pack"
              disabled={isSubmitting}
            />
            {field.state.meta.isTouched && (!field.state.value || field.state.value.trim().length === 0) && (
              <p className="text-sm text-red-600">Title is required.</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field: any) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Description</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Optional description for this product"
              rows={3}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="imageUrl">
        {(field: any) => (
          <ImageUploadField
            label="Product Image (optional)"
            value={field.state.value}
            onChange={(url) => field.handleChange(url)}
          />
        )}
      </form.Field>
    </div>
  );
}
