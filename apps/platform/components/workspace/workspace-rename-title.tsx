"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
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
    try {
      await setAlias.mutateAsync({ workspaceId, alias: trimmed });
    } catch (error) {
      console.error("Failed to rename workspace:", error);
    } finally {
      setEditing(false);
    }
  };

  const cancel = () => {
    setDraft(displayName);
    setEditing(false);
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
          className="text-xl font-semibold bg-transparent border-b border-input focus:outline-none focus:border-primary min-w-0 flex-1"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
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
                setDraft("");
                void setAlias.mutateAsync({ workspaceId, alias: "" });
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
