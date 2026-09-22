"use client";

import { useRef, useState } from "react";
import { useConvex } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { useAddToWaitlist } from "@/lib/queries/convex";
import { Form, FormField } from "@/components/form";
import { waitlistFormSchema, WaitlistFormInput } from "@/lib/validators";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/instructors/turnstile-widget";
import { api } from "@/convex/_generated/api";

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
  const [joined, setJoined] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileWidgetHandle>(null);

  const available = inventory[kind] > 0;
  const addToWaitlistMutation = useAddToWaitlist();

  let convex: ReturnType<typeof useConvex> | undefined;
  try {
    convex = useConvex();
  } catch {
    convex = undefined;
  }
  const turnstileEnforcedQuery = useQuery({
    ...convexQuery(api.waitlist.isTurnstileEnforced, {}),
    enabled: !!convex,
  });
  const turnstileSitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileEnforced = turnstileEnforcedQuery.data === true;

  async function handleWaitlistSubmit(data: WaitlistFormInput) {
    if (turnstileEnforced && !turnstileToken) {
      toast.error("Please complete the CAPTCHA before submitting.");
      return;
    }
    try {
      const result = await addToWaitlistMutation.mutateAsync({
        email: data.email,
        instructorSlug,
        mentorshipType: kind === "oneOnOne" ? "oneOnOne" : "group",
        ...(turnstileEnforced && turnstileToken
          ? { turnstileToken }
          : {}),
      });

      if (result.existingId) {
        toast.info("You're already on the waitlist!");
      } else if (result.success) {
        setJoined(true);
        toast.success("You've been added to the waitlist!");
      } else {
        toast.error(result.message || "Failed to join waitlist. Please try again.");
      }
    } catch (error) {
      const message =
        error instanceof Error && /rate.?limit/i.test(error.message)
          ? "You've submitted too many requests. Please try again later."
          : "Failed to join waitlist. Please try again.";
      toast.error(message);
    } finally {
      widgetRef.current?.reset();
    }
  }

  if (!available && !showWaitlist) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-destructive uppercase tracking-wide">
          Sold Out
        </p>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 uppercase tracking-wide text-xs font-semibold"
          onClick={() => setShowWaitlist(true)}
        >
          <Mail className="h-4 w-4" />
          Join Waitlist
        </Button>
      </div>
    );
  }

  if (!available && showWaitlist) {
    if (joined) {
      return (
        <div className="p-4 bg-card rounded-lg text-center border border-border">
          <p className="text-sm text-white/70">
            You&apos;re on the list! We&apos;ll notify you when spots open up.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-white/50 hover:text-white"
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
      <Form
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
              validators={{ onChange: waitlistFormSchema.shape.email }}
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
                    className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-white"
                    disabled={form.state.isSubmitting}
                  />
                  <Button type="submit" disabled={form.state.isSubmitting || addToWaitlistMutation.isPending || (turnstileEnforced && !turnstileToken)} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {(form.state.isSubmitting || addToWaitlistMutation.isPending) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Join"
                    )}
                  </Button>
                </div>
              )}
            </FormField>
            {turnstileEnforced && turnstileSitekey ? (
              <TurnstileWidget
                ref={widgetRef}
                sitekey={turnstileSitekey}
                action="waitlist_signup"
                onTokenChange={setTurnstileToken}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              We&apos;ll notify you when this mentorship becomes available.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-white/50 hover:text-white"
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
      size="sm"
      className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 uppercase tracking-wide text-xs font-semibold"
    >
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}
