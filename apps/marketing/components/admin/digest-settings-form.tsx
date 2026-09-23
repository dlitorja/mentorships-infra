"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  useDigestSettings,
  useUpdateDigestSettings,
  useSendDigest,
  type DigestSettings,
} from "@/lib/queries/convex";

type Frequency = DigestSettings["frequency"];

const DEFAULT_SETTINGS: DigestSettings = {
  enabled: false,
  frequency: "weekly",
  adminEmail: "",
  lastSentAt: null,
  updatedAt: null,
};

export function DigestSettingsForm() {
  const { data: serverSettings, isLoading, error: queryError, refetch } =
    useDigestSettings();
  const updateMutation = useUpdateDigestSettings();
  const sendMutation = useSendDigest();

  const [settings, setSettings] = useState<DigestSettings>(DEFAULT_SETTINGS);
  const [localAdminEmail, setLocalAdminEmail] = useState("");

  useEffect(() => {
    if (serverSettings) {
      setSettings(serverSettings);
      setLocalAdminEmail(serverSettings.adminEmail);
    }
  }, [serverSettings]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSettings((prev) => {
        if (localAdminEmail === prev.adminEmail) return prev;
        return { ...prev, adminEmail: localAdminEmail };
      });
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [localAdminEmail]);

  const saveSettings = useCallback(async (): Promise<void> => {
    try {
      const updated = await updateMutation.mutateAsync({
        enabled: settings.enabled,
        frequency: settings.frequency,
        adminEmail: settings.adminEmail,
      });
      setSettings(updated);
      setLocalAdminEmail(updated.adminEmail);
      toast.success("Digest settings saved successfully");
    } catch (err) {
      console.error("Error saving digest settings:", err);
      toast.error("Failed to save digest settings");
    }
  }, [settings, updateMutation]);

  const sendManualDigest = useCallback(async (): Promise<void> => {
    try {
      const result = await sendMutation.mutateAsync({});
      toast.success(`Digest sent to ${result.recipientEmail}`);
      await refetch();
    } catch (err) {
      console.error("Error sending manual digest:", err);
      toast.error("Failed to send digest");
    }
  }, [sendMutation, refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="max-w-3xl">
        <div className="p-6 border rounded-lg bg-destructive/10 text-destructive-foreground">
          <AlertCircle className="h-5 w-5 mb-4" />
          <h3 className="font-semibold text-lg">Failed to Load Settings</h3>
          <p className="text-sm mt-2">{queryError.message}</p>
          <Button onClick={() => refetch()} variant="outline" className="mt-4">
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
            Digest Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Digest</Label>
              <p className="text-sm text-muted-foreground">
                Automatically send digest emails based on frequency
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
              onValueChange={(value) =>
                setSettings({ ...settings, frequency: value as Frequency })
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

          {settings.lastSentAt && (
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Last sent:{" "}
                {new Date(settings.lastSentAt).toLocaleString()}
              </p>
            </div>
          )}

          <Button onClick={saveSettings} disabled={updateMutation.isPending}>
            {updateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
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
          <Button
            onClick={sendManualDigest}
            disabled={sendMutation.isPending}
            variant="outline"
          >
            {sendMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Send Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
