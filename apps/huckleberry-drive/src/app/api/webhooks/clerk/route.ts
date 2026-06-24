import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SIGNING_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 400 }
    );
  }

  if (evt.type !== "user.created") {
    return NextResponse.json({ success: true, message: "Event type not handled" });
  }

  const eventData = evt.data;
  const userId = eventData.id;
  const email = eventData.email_addresses?.[0]?.email_address;
  const firstName = eventData.first_name ?? undefined;
  const lastName = eventData.last_name ?? undefined;

  if (!email) {
    console.warn("User created event missing email:", userId);
    return NextResponse.json(
      { error: "Missing email in user.created event" },
      { status: 400 }
    );
  }

  const convexWebhookSecret = process.env.CONVEX_WEBHOOK_SECRET;
  if (!convexWebhookSecret) {
    console.error("CONVEX_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Convex webhook secret not configured" },
      { status: 500 }
    );
  }

  try {
    const result = await fetchAction(api.hdInvitations.acceptHdInvitationFromClerk, {
      email,
      clerkUserId: userId,
      webhookSecret: convexWebhookSecret,
      firstName,
      lastName,
    });

    if (!result.success) {
      if (result.reason === "unauthorized") {
        console.error("Invitation acceptance unauthorized:", result.reason);
        return NextResponse.json(
          { error: result.reason || "Unauthorized" },
          { status: 401 }
        );
      }
      console.warn("Invitation acceptance failed (non-critical):", result.reason);
      return NextResponse.json({ success: true, message: "No matching invitation found" });
    }

    return NextResponse.json({ success: true, message: "Invitation accepted" });
  } catch (err) {
    console.error("Webhook processing failed:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}