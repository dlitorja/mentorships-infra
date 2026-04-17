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
    const evt = await verifyWebhook(req);

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
