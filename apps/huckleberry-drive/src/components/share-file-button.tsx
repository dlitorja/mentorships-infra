"use client";

import React, { useState } from "react";
import { Share2 } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";

interface ShareFileButtonProps {
  fileId: string;
  originalName: string;
}

export function ShareFileButton({ fileId, originalName }: ShareFileButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-lg hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300 transition-colors"
        title="Share"
        aria-label="Share file"
      >
        <Share2 className="w-4 h-4" />
      </button>
      <ShareDialog
        uploadId={fileId}
        originalName={originalName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
