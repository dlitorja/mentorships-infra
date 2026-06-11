import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { inngest } from "@/inngest/client";

interface ClerkUserEventData {
  id: string;
  email_addresses: Array<{
    email_address: string;
  }>;
  public_metadata?: {
    role?: string;
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
 * Note: Emits diagnostic console.log on every request (svix headers,
 * body info) - see TODO re: gating behind CLERK_WEBHOOK_DEBUG.
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
    // TODO: Gate diagnostic logs behind CLERK_WEBHOOK_DEBUG or remove once
    // root cause of "No matching signature found" is identified.
    const clonedReq = req.clone();
    const rawBody = await clonedReq.text();

    let bodyInfo: Record<string, unknown> = { length: rawBody.length };
    try {
      const parsed = JSON.parse(rawBody);
      bodyInfo.isValidJson = true;
      bodyInfo.type = typeof parsed.type === "string" ? parsed.type : undefined;
      if (parsed.type === "user.created") {
        bodyInfo.hasUserId = Boolean(parsed.data?.id);
        bodyInfo.emailCount = Array.isArray(parsed.data?.email_addresses) ? parsed.data.email_addresses.length : 0;
      }
      bodyInfo.dataKeys = typeof parsed.data === "object" && parsed.data !== null
        ? Object.keys(parsed.data).filter(k => !["id", "email_addresses"].includes(k))
        : undefined;
    } catch {
      bodyInfo.isValidJson = false;
    }

    console.log("[clerk-webhook] Headers:", JSON.stringify({
      "svix-id": req.headers.get("svix-id"),
      "svix-timestamp": req.headers.get("svix-timestamp"),
      "svix-signature": req.headers.get("svix-signature")
        ? (req.headers.get("svix-signature") as string).substring(0, 50) + "..."
        : null,
      "content-type": req.headers.get("content-type"),
    }));
    console.log("[clerk-webhook] Body info:", JSON.stringify(bodyInfo));

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
