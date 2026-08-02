'use client';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import { SPECIALTY_OPTIONS, BACKGROUND_OPTIONS } from "../constants";
import type { InstructorFormData } from "../types";

interface TagsSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  customSpecialty: string;
  setCustomSpecialty: React.Dispatch<React.SetStateAction<string>>;
  customBackground: string;
  setCustomBackground: React.Dispatch<React.SetStateAction<string>>;
  toggleTag: (field: "specialties" | "background", value: string) => void;
  addCustomTag: (field: "specialties" | "background", value: string, setValue: React.Dispatch<React.SetStateAction<string>>) => void;
  setActiveTab: (tab: string) => void;
}

export function TagsSection({
  formData,
  customSpecialty,
  setCustomSpecialty,
  customBackground,
  setCustomBackground,
  toggleTag,
  addCustomTag,
  setActiveTab,
}: TagsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label>Specialties</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {SPECIALTY_OPTIONS.map((specialty) => (
              <Badge
                key={specialty}
                variant={formData.specialties.includes(specialty) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleTag("specialties", specialty)}
              >
                {specialty}
              </Badge>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <Input
              value={customSpecialty}
              onChange={(e) => setCustomSpecialty(e.target.value)}
              placeholder="Add custom specialty"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTag("specialties", customSpecialty, setCustomSpecialty))}
            />
            <Button type="button" onClick={() => addCustomTag("specialties", customSpecialty, setCustomSpecialty)} variant="secondary">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {formData.specialties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {formData.specialties.map((s) => (
                <Badge key={s} variant="secondary" className="cursor-pointer" onClick={() => toggleTag("specialties", s)}>
                  {s} <X className="ml-1 h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label>Background</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {BACKGROUND_OPTIONS.map((bg) => (
              <Badge
                key={bg}
                variant={formData.background.includes(bg) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleTag("background", bg)}
              >
                {bg}
              </Badge>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <Input
              value={customBackground}
              onChange={(e) => setCustomBackground(e.target.value)}
              placeholder="Add custom background"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTag("background", customBackground, setCustomBackground))}
            />
            <Button type="button" onClick={() => addCustomTag("background", customBackground, setCustomBackground)} variant="secondary">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {formData.background.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {formData.background.map((b) => (
                <Badge key={b} variant="secondary" className="cursor-pointer" onClick={() => toggleTag("background", b)}>
                  {b} <X className="ml-1 h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setActiveTab("images")}>Back</Button>
          <Button onClick={() => setActiveTab("social")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
