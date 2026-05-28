import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { inngest } from "@/inngest/client";

interface ClerkUserCreatedEvent {
  type: "user.created";
  data: {
    id: string;
    email_addresses: Array<{
      email_address: string;
    }>;
  };
}

/** Handle incoming Clerk webhook events for user lifecycle */
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
    // --- DIAGNOSTIC: log raw body and Svix headers ---
    const rawBody = await req.text();
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    console.log("[clerk-webhook] Headers:", JSON.stringify({
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature ? svixSignature.substring(0, 50) + "..." : null,
      "content-type": req.headers.get("content-type"),
    }));
    console.log("[clerk-webhook] Raw body length:", rawBody.length);
    console.log("[clerk-webhook] Raw body (first 200 chars):", rawBody.substring(0, 200));

    // Reconstruct request since body was consumed for logging
    const reconstructedReq = new NextRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: rawBody,
    });
    // --- END DIAGNOSTIC ---

    const evt = await verifyWebhook(reconstructedReq, { signingSecret: webhookSecret });

    const eventType = evt.type;

    if (eventType === "user.created") {
      const eventData = evt.data as ClerkUserCreatedEvent["data"];
      const userId = eventData.id;
      const email = eventData.email_addresses?.[0]?.email_address;

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
