"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Loader2 } from "lucide-react";

interface MenteeSessionControlsProps {
  sessionPackId: string;
  currentRemaining: number;
}

export function MenteeSessionControls({
  sessionPackId,
  currentRemaining,
}: MenteeSessionControlsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [remaining, setRemaining] = useState(currentRemaining);

  const handleUpdate = async (action: "increment" | "decrement") => {
    if (action === "decrement" && remaining <= 0) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/session-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionPackId, action }),
      });

      if (response.ok) {
        const data = await response.json();
        setRemaining(data.remainingSessions);
      } else {
        const error = await response.json();
        alert(error.error || "Failed to update sessions");
      }
    } catch (err) {
      console.error("Error updating sessions:", err);
      alert("Failed to update sessions");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t">
      <span className="text-sm text-muted-foreground mr-2">Adjust sessions:</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("decrement")}
        disabled={isLoading || remaining <= 0}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Minus className="h-4 w-4" />
        )}
      </Button>
      <span className="w-8 text-center font-medium">{remaining}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("increment")}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
