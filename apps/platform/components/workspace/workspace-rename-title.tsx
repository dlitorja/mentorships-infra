"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSetWorkspaceAlias } from "@/lib/queries/convex/use-workspaces";
import { Id } from "../../../../convex/_generated/dataModel";

interface WorkspaceRenameTitleProps {
  workspaceId: Id<"workspaces">;
  displayName: string;
  defaultName: string;
  /**
   * Tells the user how to get back to the default name when they've
   * set a personal alias — surfaces the canonical workspace name as
   * a "reset to default" hint.
   */
  canRename: boolean;
  className?: string;
}

/**
 * Optimistic alias override scoped to a single workspace so that
 * switching workspaces (or a late-resolving mutation for a
 * previously-selected workspace) cannot leak one workspace's alias
 * onto another.
 */
type OptimisticAlias = {
  workspaceId: Id<"workspaces">;
  value: string;
};

/**
 * Inline rename control for a workspace's title.
 *
 * - Click the pencil to edit.
 * - Enter or blur saves the new alias (or clears when the field is
 *   empty/whitespace, falling back to the default name).
 * - Escape cancels the edit.
 * - Updates run through `setWorkspaceAlias`, which is per-user —
 *   one participant's rename never affects what the other sees.
 *
 * Renaming is gated by `canRename`, which the parent sets to false
 * for read-only surfaces (admin pages, ad-hoc-call overlays, etc.).
 *
 * Failure handling: both the commit and Reset paths surface
 * errors via `sonner` and keep the editor open (commit) or restore
 * the alias indicator (reset) so the user can retry instead of
 * having their input silently discarded.
 *
 * Optimistic updates + server refresh: the parent passes
 * `displayName` from a server-rendered prop, which doesn't refresh
 * after a client-side mutation. To keep the title from reverting to
 * the default name on Enter/blur we hold an `optimisticAlias`
 * override locally (keyed by workspaceId) for immediate feedback,
 * then call `router.refresh()` so the server component re-runs with
 * the new alias. The override only applies to the workspace it
 * belongs to, so a late-resolving rename for a previously selected
 * workspace can never bleed onto the workspace the user is on now.
 */
export function WorkspaceRenameTitle({
  workspaceId,
  displayName,
  defaultName,
  canRename,
  className,
}: WorkspaceRenameTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [optimisticAlias, setOptimisticAlias] = useState<OptimisticAlias | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setAlias = useSetWorkspaceAlias();
  const router = useRouter();

  // The optimistic override applies only when it belongs to the
  // currently-rendered workspace. A late-resolving mutation for a
  // previously-selected workspace cannot bleed onto the current one.
  const effectiveDisplayName =
    optimisticAlias && optimisticAlias.workspaceId === workspaceId
      ? optimisticAlias.value
      : displayName;

  useEffect(() => {
    if (!editing) {
      setDraft(effectiveDisplayName);
    }
  }, [effectiveDisplayName, editing]);

  // Reconcile: once the parent prop carries our optimistic value
  // for this workspace, drop the override so subsequent renders
  // read straight from the (now-fresh) server-rendered prop.
  useEffect(() => {
    if (
      optimisticAlias &&
      optimisticAlias.workspaceId === workspaceId &&
      displayName === optimisticAlias.value
    ) {
      setOptimisticAlias(null);
    }
  }, [displayName, optimisticAlias, workspaceId]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const trimmed = draft.trim();
  const dirty = trimmed !== effectiveDisplayName;

  const commit = async () => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    // Capture the workspaceId at call time so a late-resolving
    // mutation can be matched against the workspace the user was
    // editing when they hit Enter (not whatever workspace they are
    // viewing now).
    const targetWorkspaceId = workspaceId;
    setSaving(true);
    try {
      await setAlias.mutateAsync({ workspaceId: targetWorkspaceId, alias: trimmed });
      // A whitespace-only draft is sent as an empty alias, which
      // the server resolves back to `defaultName`. Mirror that
      // resolution here so the reconciliation effect clears the
      // override once the server prop catches up; storing ""
      // would never reconcile and would leave the title blank.
      const optimisticValue = trimmed === "" ? defaultName : trimmed;
      setOptimisticAlias({ workspaceId: targetWorkspaceId, value: optimisticValue });
      setEditing(false);
      // Re-run the server component so the workspace list + the
      // rename control both render the new alias from the canonical
      // server-side source of truth instead of the local override.
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not rename workspace", {
        description: message,
      });
      // Keep the editor open so the user can adjust the draft and
      // retry. The local `draft` state still holds what they typed,
      // and the next attempt will surface a fresh server error.
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(effectiveDisplayName);
    setEditing(false);
  };

  const reset = async () => {
    const targetWorkspaceId = workspaceId;
    try {
      await setAlias.mutateAsync({ workspaceId: targetWorkspaceId, alias: "" });
      // Optimistically render the default name; the server resolves
      // a cleared alias back to `defaultName`, so storing the default
      // here lets the reconciliation effect clear the override once
      // the parent prop catches up. Storing "" would render a blank
      // title because displayName would never equal "".
      setOptimisticAlias({ workspaceId: targetWorkspaceId, value: defaultName });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not reset workspace name", {
        description: message,
      });
    }
  };

  const isAliased = effectiveDisplayName.trim() !== defaultName.trim();

  if (!canRename) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)}>
        <h1 className="text-xl font-semibold truncate">{effectiveDisplayName}</h1>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={120}
          aria-label="Rename workspace"
          disabled={saving}
          className="text-xl font-semibold bg-transparent border-b border-input focus:outline-none focus:border-primary min-w-0 flex-1 disabled:opacity-60"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="text-left min-w-0 flex-1 group flex items-center gap-2"
            onClick={() => setEditing(true)}
            aria-label="Rename workspace"
          >
            <h1 className="text-xl font-semibold truncate">{effectiveDisplayName}</h1>
            <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            {isAliased && (
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                renamed
              </span>
            )}
          </button>
          {isAliased && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => {
                void reset();
              }}
              title={`Reset to default: ${defaultName}`}
            >
              Reset
            </button>
          )}
        </>
      )}
    </div>
  );
}
