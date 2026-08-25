import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { inngest } from "@/inngest/client";
import { convexServerCall } from "@/lib/convex-server-call";

interface ClerkUserEventData {
  id: string;
  email_addresses: Array<{
    email_address: string;
  }>;
  public_metadata?: {
    role?: string;
    instructorId?: string;
  };
  first_name?: string;
  last_name?: string;
  previous_public_metadata?: {
    role?: string;
  };
}

interface ClerkUserCreatedEvent {
  type: "user.created";
  data: ClerkUserEventData;
}

interface ClerkUserUpdatedEvent {
  type: "user.updated";
  data: ClerkUserEventData;
}

/**
 * POST /api/webhooks/clerk
 * Handles Clerk webhook events for user lifecycle management.
 * Verifies webhook signature using CLERK_WEBHOOK_SIGNING_SECRET.
 * Dispatches user.created and user.deleted events to Inngest for
 * async processing (e.g., creating/deleting corresponding user records).
 */
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SIGNING_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  try {
    const evt = await verifyWebhook(req, { signingSecret: webhookSecret });

    const eventType = evt.type;

    if (eventType === "user.created") {
      const eventData = evt.data as ClerkUserCreatedEvent["data"];
      const userId = eventData.id;
      const email = eventData.email_addresses?.[0]?.email_address;
      const role = eventData.public_metadata?.role as string | undefined;
      const firstName = eventData.first_name;
      const lastName = eventData.last_name;

      if (!email) {
        console.warn("User created event missing email:", userId);
        return NextResponse.json(
          { error: "Missing email in user.created event" },
          { status: 400 }
        );
      }

      const normalizedEmail = email.toLowerCase().trim();

      // If the invited Clerk user carries an instructorId in public metadata
      // (set by the admin dashboard invitation flow), link the real Clerk
      // userId to the existing placeholder instructor record immediately.
      // Without this, the instructor record still references `admin-<slug>`
      // and the instructor cannot see their workspaces.
      const instructorId = eventData.public_metadata?.instructorId;
      if (role === "instructor" && instructorId) {
        try {
          await convexServerCall<{ success: boolean }>("/instructors/create-for-clerk-user", {
            userId,
            email: normalizedEmail,
            name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          });
        } catch (linkErr) {
          console.error(
            "Clerk webhook: failed to link instructor record for",
            userId,
            linkErr
          );
        }
      }

      await inngest.send({
        name: "clerk/user.created",
        data: {
          userId,
          email,
          role,
          firstName,
          lastName,
        },
      });

      // Link placeholder data created by the admin-onboarding flow
      // (session packs, seat reservations, and workspaces) to the new
      // Clerk user. This mirrors the Inngest `linkClerkUserToSessionPacks`
      // function but runs synchronously in the webhook so the student is
      // usable immediately even if the event bus is delayed or the Inngest
      // function is not registered for this deployment.
      const linkResults = await Promise.allSettled([
        convexServerCall<{ linked: number }>("/internal/link-session-packs", {
          clerkUserId: userId,
          email: normalizedEmail,
        }),
        convexServerCall<{ linked: number }>("/internal/link-seat-reservations", {
          clerkUserId: userId,
          email: normalizedEmail,
        }),
        convexServerCall<{ linked: number }>("/internal/link-workspaces", {
          clerkUserId: userId,
          email: normalizedEmail,
        }),
      ]);

      const linkNames = ["session-packs", "seat-reservations", "workspaces"];
      for (let i = 0; i < linkResults.length; i++) {
        const result = linkResults[i];
        if (result.status === "rejected") {
          console.error(
            `Clerk webhook: failed to link ${linkNames[i]} for ${userId} (${normalizedEmail})`,
            result.reason
          );
        }
      }

      return NextResponse.json({ success: true, message: "Event queued" });
    }

    if (eventType === "user.updated") {
      const eventData = evt.data as ClerkUserUpdatedEvent["data"];
      const userId = eventData.id;
      const email = eventData.email_addresses?.[0]?.email_address;
      const role = eventData.public_metadata?.role as string | undefined;
      const firstName = eventData.first_name;
      const lastName = eventData.last_name;
      const previousRole = eventData.previous_public_metadata?.role as string | undefined;

      if (!email) {
        console.warn("User updated event missing email:", userId);
        return NextResponse.json(
          { error: "Missing email in user.updated event" },
          { status: 400 }
        );
      }

      await inngest.send({
        name: "clerk/user.updated",
        data: {
          userId,
          email,
          role,
          firstName,
          lastName,
          previousRole,
        },
      });

      return NextResponse.json({ success: true, message: "Event queued" });
    }

    if (eventType === "user.deleted") {
      const eventData = evt.data as { id: string };
      const userId = eventData.id;

      await inngest.send({
        name: "clerk/user.deleted",
        data: {
          userId,
        },
      });

      return NextResponse.json({ success: true, message: "Event queued" });
    }

    return NextResponse.json({ success: true, message: "Event type not handled" });
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 400 }
    );
  }
}
