"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Bell, Send, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const digestSettingsSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  admin_email: z.string().email(),
  last_sent_at: z.string().nullable(),
  updated_at: z.string(),
});

type DigestSettings = z.infer<typeof digestSettingsSchema>;

const sendDigestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  recipientEmail: z.string().email(),
});

export function DigestSettingsForm() {
  const [settings, setSettings] = useState<DigestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [localAdminEmail, setLocalAdminEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (settings && localAdminEmail !== settings.admin_email) {
        setSettings({ ...settings, admin_email: localAdminEmail });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [localAdminEmail, settings]);

  async function fetchSettings() {
    try {
      const response = await fetch("/api/admin/digest-settings");
      if (!response.ok) throw new Error("Failed to fetch settings");
      const data = await response.json();
      const validatedData = digestSettingsSchema.safeParse(data);
      if (!validatedData.success) {
        console.error("Invalid digest settings data:", validatedData.error.format());
        toast.error("Failed to load digest settings");
        setError("Invalid settings data received from server");
        return;
      }

      setSettings(validatedData.data);
      setLocalAdminEmail(validatedData.data.admin_email);
      setError(null);
    } catch (err) {
      console.error("Error fetching digest settings:", err);
      toast.error("Failed to load digest settings");
      setError("Failed to load settings. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;

    setSaving(true);
    try {
      const response = await fetch("/api/admin/digest-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          frequency: settings.frequency,
          adminEmail: settings.admin_email,
        }),
      });

      if (!response.ok) throw new Error("Failed to save settings");

      toast.success("Digest settings saved successfully");
    } catch (err) {
      console.error("Error saving digest settings:", err);
      toast.error("Failed to save digest settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendManualDigest() {
    setSending(true);
    try {
      const response = await fetch("/api/admin/digest-send", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to send digest");

      const data = await response.json();
      const validatedData = sendDigestResponseSchema.safeParse(data);
      if (!validatedData.success) {
        console.error("Invalid digest send response:", validatedData.error.format());
        toast.error("Failed to parse digest send response");
        return;
      }

      toast.success(`Digest sent to ${validatedData.data.recipientEmail}`);
      fetchSettings();
    } catch (err) {
      console.error("Error sending manual digest:", err);
      toast.error("Failed to send digest");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="max-w-3xl">
        <div className="p-6 border rounded-lg bg-destructive/10 text-destructive-foreground">
          <AlertCircle className="h-5 w-5 mb-4" />
          <h3 className="font-semibold text-lg">Failed to Load Settings</h3>
          <p className="text-sm mt-2">{error || "Unable to load digest settings."}</p>
          <Button onClick={fetchSettings} variant="outline" className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Weekly Digest Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Digest</Label>
              <p className="text-sm text-muted-foreground">
                Automatically send weekly digest emails
              </p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, enabled: checked })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Frequency</Label>
            <Select
              value={settings.frequency}
              onValueChange={(value: "daily" | "weekly" | "monthly") =>
                setSettings({ ...settings, frequency: value })
              }
            >
              <SelectTrigger id="frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adminEmail">Admin Email</Label>
            <Input
              id="adminEmail"
              type="email"
              value={localAdminEmail}
              onChange={(e) => setLocalAdminEmail(e.target.value)}
              placeholder="admin@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Digest emails will be sent to this address
            </p>
          </div>

          {settings.last_sent_at && (
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Last sent:{" "}
                {new Date(settings.last_sent_at).toLocaleString()}
              </p>
            </div>
          )}

          <Button onClick={saveSettings} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Manual Digest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Send a digest email immediately to test or on-demand
          </p>
          <Button onClick={sendManualDigest} disabled={sending} variant="outline">
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
