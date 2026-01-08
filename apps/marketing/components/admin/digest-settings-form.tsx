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
import { Loader2, Bell, Send } from "lucide-react";
import { toast } from "sonner";

interface DigestSettings {
  id: string;
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  admin_email: string;
  last_sent_at: string | null;
  updated_at: string;
}

export function DigestSettingsForm() {
  const [settings, setSettings] = useState<DigestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const response = await fetch("/api/admin/digest-settings");
      if (!response.ok) throw new Error("Failed to fetch settings");
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error("Error fetching digest settings:", error);
      toast.error("Failed to load digest settings");
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
    } catch (error) {
      console.error("Error saving digest settings:", error);
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
      toast.success(`Digest sent to ${data.recipientEmail}`);
      fetchSettings();
    } catch (error) {
      console.error("Error sending manual digest:", error);
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

  if (!settings) return null;

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
              value={settings.admin_email}
              onChange={(e) =>
                setSettings({ ...settings, admin_email: e.target.value })
              }
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
