"use client";

import { useEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setAlias = useSetWorkspaceAlias();

  useEffect(() => {
    if (!editing) {
      setDraft(displayName);
    }
  }, [displayName, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const trimmed = draft.trim();
  const dirty = trimmed !== displayName;

  const commit = async () => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await setAlias.mutateAsync({ workspaceId, alias: trimmed });
      setEditing(false);
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
    setDraft(displayName);
    setEditing(false);
  };

  const reset = async () => {
    try {
      await setAlias.mutateAsync({ workspaceId, alias: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Could not reset workspace name", {
        description: message,
      });
    }
  };

  const isAliased = displayName.trim() !== defaultName.trim();

  if (!canRename) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)}>
        <h1 className="text-xl font-semibold truncate">{displayName}</h1>
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
            <h1 className="text-xl font-semibold truncate">{displayName}</h1>
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
