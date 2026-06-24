import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface ClerkUserCreatedEvent {
  type: "user.created";
  data: {
    id: string;
    email_addresses: Array<{
      email_address: string;
    }>;
    first_name?: string;
    last_name?: string;
    public_metadata?: {
      role?: "student" | "instructor" | "admin" | "video_editor";
    };
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

    if (evt.type !== "user.created") {
      return NextResponse.json({ success: true, message: "Event type not handled" });
    }

    const eventData = evt.data as ClerkUserCreatedEvent["data"];
    const userId = eventData.id;
    const email = eventData.email_addresses?.[0]?.email_address;
    const firstName = eventData.first_name;
    const lastName = eventData.last_name;
    const roleFromClerk = eventData.public_metadata?.role;

    if (!email) {
      console.warn("User created event missing email:", userId);
      return NextResponse.json(
        { error: "Missing email in user.created event" },
        { status: 400 }
      );
    }

    await fetchAction(api.hdInvitations.acceptHdInvitationFromClerk, {
      email,
      clerkUserId: userId,
      role: roleFromClerk,
      firstName,
      lastName,
    });

    return NextResponse.json({ success: true, message: "Invitation accepted" });
  } catch (err) {
    console.error("Webhook verification or processing failed:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 400 }
    );
  }
}