"use client";

import React, { use } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft, Save, Globe } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAdminWorkspace, updateAdminWorkspace } from "@/lib/queries/api-client";

type WorkspaceDetail = {
  id: string;
  name: string;
  description: string | null;
  type: "mentorship" | "admin_student" | "admin_instructor";
  ownerId: string;
  isPublic: boolean;
  endedAt: number | null;
  createdAt: number;
};

export default function WorkspaceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const workspaceId = resolvedParams.id;
  const queryClient = useQueryClient();

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["admin-workspace", workspaceId],
    queryFn: () => getAdminWorkspace(workspaceId) as Promise<WorkspaceDetail>,
  });

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(false);
  const [isSaved, setIsSaved] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  /** Private → public is the one setting here that widens access; confirm it. */
  const [confirmPublic, setConfirmPublic] = React.useState(false);

  React.useEffect(() => {
    if (workspace) {
      setName(workspace.name || "");
      setDescription(workspace.description || "");
      setIsPublic(workspace.isPublic || false);
    }
  }, [workspace]);

  const updateMutation = useMutation({
    mutationFn: () => updateAdminWorkspace(workspaceId, { name, description, isPublic }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workspace", workspaceId] });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Workspace name is required");
      return;
    }
    setNameError(null);
    updateMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center text-destructive">
          Failed to load workspace: {error?.message || "Not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/admin/workspaces/${workspaceId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Workspace Settings</h1>
          <p className="text-muted-foreground">
            Manage workspace configuration for {workspace.name}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Basic workspace information and visibility settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="Workspace name"
              />
              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description || ""}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Workspace description (optional)"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="isPublic">Public Visibility</Label>
                <p className="text-sm text-muted-foreground">
                  Allow workspace to be accessed via direct link without authentication
                </p>
              </div>
              <Switch
                id="isPublic"
                checked={isPublic}
                onCheckedChange={(next) => {
                  if (next && !isPublic) {
                    setConfirmPublic(true);
                    return;
                  }
                  setIsPublic(next);
                }}
              />
            </div>

            {updateMutation.error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {updateMutation.error.message}
              </div>
            )}

            {isSaved && (
              <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">
                Settings saved successfully
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Dialog open={confirmPublic} onOpenChange={setConfirmPublic}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-amber-600" />
              Make this workspace public?
            </DialogTitle>
            <DialogDescription>
              Anyone with the link can open &quot;{workspace.name}&quot; without signing in. The
              workspace&apos;s messages and shared files become readable to them.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            This takes effect when you press <strong>Save Changes</strong>. You can switch it back
            to private at any time.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmPublic(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setIsPublic(true);
                setConfirmPublic(false);
              }}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Yes, make it public
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="max-w-2xl mt-6">
        <CardHeader>
          <CardTitle>Workspace Info</CardTitle>
          <CardDescription>
            Read-only information about this workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">{workspace.type}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">
                {new Date(workspace.createdAt).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owner ID</dt>
              <dd className="font-medium font-mono text-xs">{workspace.ownerId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                {workspace.endedAt ? "Ended" : "Active"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}