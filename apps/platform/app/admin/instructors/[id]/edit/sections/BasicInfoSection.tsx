'use client';

import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isValidDiscordUrl } from "@/lib/validation/discord";
import { NONE_SENTINEL } from "../types";
import type { InstructorsResponse, InstructorFormData } from "../types";

interface BasicInfoSectionProps {
  formData: InstructorFormData;
  setFormData: React.Dispatch<React.SetStateAction<InstructorFormData>>;
  setActiveTab: (tab: string) => void;
  instructorsData?: InstructorsResponse;
  onSendInvitation: () => void;
  isSendingInvitation: boolean;
}

export function BasicInfoSection({
  formData,
  setFormData,
  setActiveTab,
  instructorsData,
  onSendInvitation,
  isSendingInvitation,
}: BasicInfoSectionProps) {
  const discordUrl = (formData.discordVoiceChannelUrl || "").trim();
  const isDiscordUrlInvalid = !isValidDiscordUrl(discordUrl);

  const hasEmail = !!(formData.email || "").trim();
  const alreadyConnected = !!formData.userId;
  const canInvite = hasEmail && !alreadyConnected;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmSend = () => {
    setConfirmOpen(false);
    onSendInvitation();
  };

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
            <p className="text-xs text-muted-foreground mt-1">
              Save the profile first, then use the button below to send the invitation.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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
            {!alreadyConnected && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canInvite || isSendingInvitation}
                onClick={() => setConfirmOpen(true)}
                title={
                  !hasEmail
                    ? "Set an email first"
                    : "Send a Clerk invitation to this email"
                }
              >
                {isSendingInvitation ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Clerk Invitation
                  </>
                )}
              </Button>
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="isListed"
            checked={formData.isListed}
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isListed: checked === true }))}
          />
          <Label htmlFor="isListed" className="cursor-pointer">Listed</Label>
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Clerk Invitation</DialogTitle>
            <DialogDescription>
              We will send a sign-up invitation to{" "}
              <span className="font-medium text-foreground">{formData.email}</span>.
              They will create a Clerk account, and once they accept, this
              instructor profile will be linked automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isSendingInvitation}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSend} disabled={isSendingInvitation}>
              {isSendingInvitation ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send Invitation"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
