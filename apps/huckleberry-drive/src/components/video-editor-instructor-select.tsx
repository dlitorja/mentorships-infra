"use client";

import React from "react";
import { User } from "lucide-react";

interface Instructor {
  id: string;
  name: string | null;
  email: string;
}

interface VideoEditorInstructorSelectProps {
  instructors: Instructor[];
  selectedInstructorId: string | null;
  onSelect: (instructorId: string) => void;
}

export function VideoEditorInstructorSelect({
  instructors,
  selectedInstructorId,
  onSelect,
}: VideoEditorInstructorSelectProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
        <User className="w-4 h-4" />
        Upload to instructor
      </label>
      <select
        value={selectedInstructorId || ""}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      >
        <option value="">Select an instructor...</option>
        {instructors.map((instructor) => (
          <option key={instructor.id} value={instructor.id}>
            {instructor.name || instructor.email}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">
        Select the instructor whose files you are uploading for
      </p>
    </div>
  );
}