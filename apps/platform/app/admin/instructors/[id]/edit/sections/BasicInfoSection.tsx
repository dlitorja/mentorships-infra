'use client';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isValidDiscordUrl } from "@/lib/validation/discord";
import { NONE_SENTINEL } from "../types";
import type { InstructorsResponse, InstructorFormData } from "../types";

interface BasicInfoSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  setActiveTab: (tab: string) => void;
  instructorsData?: InstructorsResponse;
}

export function BasicInfoSection({ formData, setFormData, setActiveTab, instructorsData }: BasicInfoSectionProps) {
  const discordUrl = (formData.discordVoiceChannelUrl || "").trim();
  const isDiscordUrlInvalid = !isValidDiscordUrl(discordUrl);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="slug">Slug *</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
          />
        </div>
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div>
            <Label htmlFor="email">Email (for Clerk Invitation)</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="instructor@example.com"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Clerk Status:</span>
            {formData.userId ? (
              <Badge variant="default" className="bg-green-600">
                Connected
              </Badge>
            ) : formData.email ? (
              <Badge variant="outline">Not Connected</Badge>
            ) : (
              <Badge variant="secondary">No Email</Badge>
            )}
          </div>
          {formData.userId && (
            <p className="text-xs text-muted-foreground">Clerk User ID: {formData.userId}</p>
          )}
        </div>
        <div>
          <Label htmlFor="tagline">Tagline</Label>
          <Input
            id="tagline"
            value={formData.tagline}
            onChange={(e) => setFormData((prev) => ({ ...prev, tagline: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={formData.bio}
            onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
            rows={6}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="isActive"
            checked={formData.isActive}
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isActive: checked === true }))}
          />
          <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
        </div>
        <div>
          <Label htmlFor="discordVoiceChannelUrl">Discord Voice Channel URL</Label>
          <Input
            id="discordVoiceChannelUrl"
            value={formData.discordVoiceChannelUrl || ""}
            onChange={(e) => setFormData((prev) => ({ ...prev, discordVoiceChannelUrl: e.target.value }))}
            placeholder="https://discord.gg/your-channel or https://discord.com/channels/..."
          />
          {isDiscordUrlInvalid ? (
            <p className="text-xs text-red-600 mt-1">Enter a valid HTTPS Discord link (discord.gg or discord.com)</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              Must be an HTTPS Discord link. Leave blank to clear.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="instructorId">Instructor ID</Label>
          <Select
            value={formData.instructorId ?? NONE_SENTINEL}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, instructorId: value === NONE_SENTINEL ? null : value }))}
          >
            <SelectTrigger id="instructorId">
              <SelectValue placeholder="Select an instructor ID" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>None</SelectItem>
              {instructorsData?.instructors?.map((instructor) => (
                <SelectItem key={instructor.instructorId} value={instructor.instructorId}>
                  {instructor.email || instructor.instructorId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => setActiveTab("images")}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}
