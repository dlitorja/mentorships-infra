"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { addToWaitlist } from "@/lib/supabase-inventory";
import { Form, FormField } from "@/components/form";
import { waitlistFormSchema } from "@/lib/validators";

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

interface WaitlistFormData {
  email: string;
}

export function OfferButton({ kind, label, url, inventory, instructorSlug }: OfferButtonProps) {
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [joined, setJoined] = useState(false);

  const available = inventory[kind] > 0;

  async function handleWaitlistSubmit(data: WaitlistFormData) {
    try {
      const result = await addToWaitlist(
        data.email,
        instructorSlug,
        kind === "oneOnOne" ? "one-on-one" : "group"
      );

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
    }
  }

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
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </div>
      );
    }

    return (
      <Form<WaitlistFormData>
        defaultValues={{ email: "" }}
        validators={{ onChange: waitlistFormSchema }}
        onSubmit={handleWaitlistSubmit}
      >
        {(form) => (
          <div className="space-y-3">
            <FormField
              name="email"
              label="Email"
              placeholder="Enter your email"
              type="email"
              validator={{ onChange: waitlistFormSchema.shape.email }}
            >
              {(field) => (
                <div className="flex gap-2">
                  <input
                    id={field.name}
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Enter your email"
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    disabled={form.state.isSubmitting}
                  />
                  <Button type="submit" disabled={form.state.isSubmitting}>
                    {form.state.isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Join"
                    )}
                  </Button>
                </div>
              )}
            </FormField>
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
          </div>
        )}
      </Form>
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
