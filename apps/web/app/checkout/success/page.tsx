"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";

// Force dynamic rendering to prevent static generation issues with useSearchParams
export const dynamic = "force-dynamic";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    // Verify the session if session_id is provided
    if (sessionId) {
      verifySession(sessionId);
    } else {
      setLoading(false);
    }
  }, [sessionId]);

  const verifySession = async (id: string) => {
    try {
      const response = await fetch(`/api/checkout/verify?session_id=${id}`);
      if (response.ok) {
        setVerified(true);
      }
    } catch (error) {
      console.error("Failed to verify session:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-md w-full">
      <CardHeader className="text-center">
        {loading ? (
          <>
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
            <CardTitle>Processing...</CardTitle>
            <CardDescription>
              Verifying your payment
            </CardDescription>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <CardTitle>Payment Successful!</CardTitle>
            <CardDescription>
              Your session pack has been purchased successfully
            </CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading && (
          <>
            <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p>
                <strong>What&apos;s next?</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Your session pack is now active</li>
                <li>You can book your sessions from the dashboard</li>
                <li>Check your email for confirmation</li>
              </ul>
            </div>

            {sessionId && (
              <div className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                Session ID: {sessionId}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/instructors">Browse Instructors</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Suspense
        fallback={
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
              <CardTitle>Loading...</CardTitle>
              <CardDescription>Please wait</CardDescription>
            </CardHeader>
          </Card>
        }
      >
        <CheckoutSuccessContent />
      </Suspense>
    </div>
  );
}

