"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import { queryKeys } from "@/lib/queries/query-keys";
import { getCheckoutStatus } from "@/lib/queries/api-client";
import { useUser } from "@clerk/nextjs";

type Phase = "processing" | "ready" | "failed" | "timeout";

const POLL_INTERVAL_MS = 2000;
const GIVE_UP_MS = 60_000;

async function capturePayPalOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch("/api/checkout/paypal/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { success: false, error: body?.error ?? "Capture failed" };
  }
  return { success: true };
}

function CheckoutSuccessContent(): React.JSX.Element {
  const searchParams = useSearchParams();

  // Our Convex order id drives every status read. The provider-specific ids
  // (`session_id`, PayPal's `order_id`) are only used for the provider call.
  const orderId =
    searchParams?.get("checkout_order_id") || searchParams?.get("order_id") || null;
  const paypalOrderId = searchParams?.get("order_id") || null;
  const stripeSessionId = searchParams?.get("session_id") || null;
  const isNew = searchParams?.get("new") === "1";
  const isGuest = searchParams?.get("guest") === "1";
  const magicLinkFailed = searchParams?.get("magic_link_failed") === "1";
  const isPayPalReturn = Boolean(paypalOrderId) && !stripeSessionId;

  const { isSignedIn } = useUser();
  const [phase, setPhase] = useState<Phase>("processing");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [attemptsExhausted, setAttemptsExhausted] = useState(false);
  const captureStarted = useRef(false);
  const startedAt = useRef(Date.now());

  const capture = useMutation({
    mutationFn: capturePayPalOrder,
    onError: () => setCaptureError("We could not complete the PayPal payment."),
    onSuccess: (result) => {
      if (!result.success) {
        setCaptureError(result.error ?? "We could not complete the PayPal payment.");
      }
    },
  });

  // PayPal returns an APPROVED order; it is not paid until captured. Capture
  // exactly once per page load, then let the status poll observe fulfilment.
  useEffect(() => {
    if (!isPayPalReturn || !paypalOrderId || captureStarted.current) return;
    captureStarted.current = true;

    capture.mutate(paypalOrderId, {
      onSuccess: (result) => {
        if (!result.success) {
          setPhase("failed");
        }
      },
      onError: () => setPhase("failed"),
    });
    // `capture` is stable for the lifetime of this component; re-running on
    // identity changes would double-capture the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayPalReturn, paypalOrderId]);

  const { data: status, isError: statusError } = useQuery({
    queryKey: queryKeys.checkout.status(orderId ?? ""),
    queryFn: () => getCheckoutStatus(orderId!),
    enabled: Boolean(orderId),
    retry: 2,
    refetchInterval: (query) => {
      const current = query.state.data;

      if (current) {
        if (current.packStatus) return false;
        if (current.orderStatus === "failed" || current.orderStatus === "canceled") return false;
      }
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
  });

  useEffect(() => {
    if (!status) return;

    if (status.packStatus) {
      setPhase("ready");
      return;
    }
    if (status.orderStatus === "failed" || status.orderStatus === "canceled") {
      setPhase("failed");
      return;
    }
    if (Date.now() - startedAt.current > GIVE_UP_MS) {
      setPhase("timeout");
      setAttemptsExhausted(true);
      return;
    }
    setPhase("processing");
  }, [status]);

  useEffect(() => {
    if (!captureError) return;
    setPhase("failed");
  }, [captureError]);

  useEffect(() => {
    if (statusError) setPhase("failed");
  }, [statusError]);

  // Polling stops at the deadline, so a timeout has to be raised independently
  // of the next status response.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase((current) => (current === "processing" ? "timeout" : current));
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);

  const missingOrder = !orderId;
  const canRetry = isPayPalReturn;

  return (
    <Card className="max-w-md w-full">
      <CardHeader className="text-center">
        {missingOrder ? (
          <>
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <CardTitle>We couldn&apos;t find your order</CardTitle>
            <CardDescription>
              This link is missing the order reference. If you were charged, contact
              support and we&apos;ll find it for you.
            </CardDescription>
          </>
        ) : phase === "processing" ? (
          <>
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
            <CardTitle>Setting up your mentorship</CardTitle>
            <CardDescription>
              {capture.isPending
                ? "Confirming your payment with PayPal"
                : "Payment received — creating your session pack"}
            </CardDescription>
          </>
        ) : phase === "ready" ? (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <CardTitle>You&apos;re all set</CardTitle>
            <CardDescription>
              Your session pack is active
              {status?.totalSessions ? ` — ${status.totalSessions} sessions ready to book` : ""}
            </CardDescription>
          </>
        ) : phase === "timeout" ? (
          <>
            <Clock className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <CardTitle>Still setting things up</CardTitle>
            <CardDescription>
              This is taking longer than usual, but your payment is recorded. You&apos;ll
              get an email as soon as access is ready.
            </CardDescription>
          </>
        ) : (
          <>
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <CardTitle>Something needs attention</CardTitle>
            <CardDescription>
              {captureError ??
                (statusError
                  ? "We couldn't read your order status."
                  : "We couldn't complete this purchase.")}
            </CardDescription>
          </>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {!missingOrder && phase === "processing" && (
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm text-muted-foreground">
            <p>You can safely leave this page — we&apos;ll email you when it&apos;s ready.</p>
            <p className="text-xs">
              This usually takes a few seconds. Do not pay again.
            </p>
          </div>
        )}

        {!missingOrder && phase === "ready" && (
          <>
            {magicLinkFailed && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-lg">
                We couldn&apos;t send your login link automatically. Sign in or create an
                account with the email you used at checkout.
              </div>
            )}

            <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">What&apos;s next</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Check your email for the confirmation and onboarding invite</li>
                <li>Complete the short questionnaire so your instructor knows where to start</li>
                <li>Book your first session from the dashboard</li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              {!isSignedIn ? (
                isNew && !isGuest ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      {magicLinkFailed ? (
                        <p>Sign in or create an account to open your pack.</p>
                      ) : (
                        <p>
                          Check your email — we&apos;ve sent you a login link to open your
                          pack.
                        </p>
                      )}
                    </div>
                    <Button asChild className="w-full">
                      <Link href="/sign-in">
                        {magicLinkFailed ? "Sign In" : "Check your email for login link"}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/sign-up">Create an account instead</Link>
                    </Button>
                  </>
                ) : isGuest ? (
                  <>
                    <div className="text-sm text-muted-foreground">
                      <p>
                        Check your email — we&apos;ve sent you a login link to open your
                        pack.
                      </p>
                    </div>
                    <Button asChild className="w-full">
                      <Link href="/sign-in">Sign In</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/sign-up">Create an account instead</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild className="w-full">
                      <Link href="/sign-in">Sign In to Your Account</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/sign-up">Create an Account</Link>
                    </Button>
                  </>
                )
              ) : (
                <Button asChild className="w-full">
                  <Link href="/dashboard">Go to Dashboard</Link>
                </Button>
              )}
            </div>
          </>
        )}

        {!missingOrder && (phase === "failed" || phase === "timeout") && (
          <div className="flex flex-col gap-2">
            {canRetry && !attemptsExhausted && (
              <Button
                className="w-full"
                disabled={capture.isPending}
                onClick={() => {
                  if (!paypalOrderId) return;
                  setCaptureError(null);
                  capture.mutate(paypalOrderId);
                }}
              >
                {capture.isPending ? "Retrying…" : "Retry payment confirmation"}
              </Button>
            )}
            <Button asChild variant="outline" className="w-full">
              <a href="mailto:support@huckleberry.art">Contact support</a>
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Please don&apos;t pay again until we confirm this order.
              {orderId ? ` Reference: ${orderId.slice(-8)}` : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CheckoutSuccessPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Suspense
        fallback={
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
              <CardTitle>Loading…</CardTitle>
              <CardDescription>Checking your order</CardDescription>
            </CardHeader>
          </Card>
        }
      >
        <CheckoutSuccessContent />
      </Suspense>
    </div>
  );
}
