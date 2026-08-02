'use client';

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductTypeSectionProps {
  form: any;
}

export function ProductTypeSection({ form }: ProductTypeSectionProps) {
  return (
    <form.Field name="mentorshipType">
      {(field: any) => (
        <div className="space-y-2">
          <Label htmlFor={field.name}>Session Type *</Label>
          <Select
            value={field.state.value}
            onValueChange={(v) => {
              field.handleChange(v);
              field.handleBlur();
            }}
          >
            <SelectTrigger id={field.name}>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one-on-one">1-on-1 Session</SelectItem>
              <SelectItem value="group">Group Session</SelectItem>
            </SelectContent>
          </Select>
          {field.state.meta.isTouched && (!field.state.value || (field.state.value !== "one-on-one" && field.state.value !== "group")) && (
            <p className="text-sm text-red-600">Please select a session type.</p>
          )}
        </div>
      )}
    </form.Field>
  );
}
