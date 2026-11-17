"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { ApiFetchError, deleteAdminWorkspace } from "@/lib/queries/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type WorkspaceDeleteDialogProps = {
  workspaceId: string;
  workspaceName: string;
  trigger?: React.ReactNode;
};

export function WorkspaceDeleteDialog({
  workspaceId,
  workspaceName,
  trigger,
}: WorkspaceDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  // `/admin/workspaces/<id>` (or a nested members/settings route) vs the list.
  const isDetailPage = !!pathname && /^\/admin\/workspaces\/[^/]+/.test(pathname);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteAdminWorkspace(workspaceId);

      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-workspaces"], exact: false });
      // On the detail page the workspace we are looking at no longer exists, so
      // "invalidate + refresh" left the admin staring at "Not found". Return to
      // the list instead.
      if (isDetailPage) {
        router.push("/admin/workspaces");
      } else {
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiFetchError && typeof err.data === "object" && err.data !== null && "error" in err.data && typeof err.data.error === "string") {
        setError(err.data.error);
      } else {
        setError(err instanceof Error ? err.message : "Failed to delete workspace");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" aria-label="Delete workspace">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Workspace</DialogTitle>
          <DialogDescription>
            Remove &quot;{workspaceName}&quot; from the app? It disappears for the student, the
            instructor, and every admin, and there is no admin control to restore it — an engineer
            would have to undo the soft delete. Messages and audit history are retained.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Workspace
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}