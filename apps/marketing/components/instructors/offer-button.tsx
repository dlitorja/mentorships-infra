"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { addToWaitlist } from "@/lib/supabase-inventory";

interface InventoryStatus {
  oneOnOne: number;
  group: number;
}

interface OfferButtonProps {
  kind: "oneOnOne" | "group";
  label: string;
  url: string;
  inventory: InventoryStatus;
  instructorSlug: string;
}

export function OfferButton({ kind, label, url, inventory, instructorSlug }: OfferButtonProps) {
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  const available = inventory[kind] > 0;

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSubmitting(true);
    try {
      const result = await addToWaitlist(email, instructorSlug, kind === "oneOnOne" ? "one-on-one" : "group");
      
      if (result?.alreadyOnWaitlist) {
        toast.info("You're already on the waitlist!");
      } else if (result) {
        setJoined(true);
        toast.success("You've been added to the waitlist!");
      } else {
        toast.error("Failed to join waitlist. Please try again.");
      }
    } catch (error) {
      toast.error("Failed to join waitlist. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!available && !showWaitlist) {
    return (
      <div className="space-y-2">
        <Button
          size="lg"
          className="vibrant-gradient-button transition-all gap-2 w-full"
          disabled
        >
          <span className="text-muted-foreground">Sold Out</span>
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => setShowWaitlist(true)}
        >
          <Mail className="h-4 w-4 mr-2" />
          Join Waitlist
        </Button>
      </div>
    );
  }

  if (!available && showWaitlist) {
    if (joined) {
      return (
        <div className="p-4 bg-muted/30 rounded-lg text-center">
          <p className="text-sm text-muted-foreground">
            You're on the list! We'll notify you when spots open up.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setShowWaitlist(false);
              setJoined(false);
              setEmail("");
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </div>
      );
    }

    return (
      <form onSubmit={handleWaitlistSubmit} className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Join"
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          We'll notify you when this mentorship becomes available.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowWaitlist(false)}
        >
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <Button
      asChild
      size="lg"
      className="vibrant-gradient-button transition-all gap-2 w-full"
    >
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}
