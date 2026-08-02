'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SOCIAL_PLATFORMS } from "../constants";
import type { InstructorFormData, Socials } from "../types";

interface SocialLinksSectionProps {
  formData: InstructorFormData;
  updateSocial: (key: keyof Socials, value: string) => void;
  setActiveTab: (tab: string) => void;
}

export function SocialLinksSection({ formData, updateSocial, setActiveTab }: SocialLinksSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Social Links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={formData.socials[key as keyof Socials] || ""}
              onChange={(e) => updateSocial(key as keyof Socials, e.target.value)}
              placeholder={placeholder}
            />
          </div>
        ))}
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setActiveTab("tags")}>Back</Button>
          <Button onClick={() => setActiveTab("inventory")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
