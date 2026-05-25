import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { createPayPalOrder } from "@mentorships/payments";
import crypto from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    // Public checkout: proceed without authentication
    const rawBody = await req.json();
    // Minimal compatibility: accept either `packId` or `productId`
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? { packId: rawBody.packId ?? rawBody.productId, email: rawBody.email, fullName: rawBody.fullName }
        : rawBody;

    const validationResult = checkoutSchema.safeParse(body as unknown);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { packId, email, fullName } = validationResult.data;
    const convex = getConvexClient();

    // Use public lookup to support guest checkout
    const pack = await convex.query(api.products.getPublicProductById, {
      id: packId as Id<"products">,
    });

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    // Resolve user: if authenticated, use that userId; otherwise upsert by email
    const { userId: authedUserId } = await auth();
    let userIdForOrder: string | null = authedUserId ?? null;

    let createdNewUser = false;
    if (!userIdForOrder) {
      if (!email || !fullName) {
        return NextResponse.json(
          { error: "Email and full name are required" },
          { status: 400 }
        );
      }
      const client = await clerkClient();
      const normalizedEmail = email.trim().toLowerCase();
      const { data } = await client.users.getUserList({ emailAddress: [normalizedEmail] } as any);
      if (data.length > 0) {
        userIdForOrder = data[0].id;
      } else {
        const [firstName, ...rest] = fullName.trim().split(" ");
        const lastName = rest.join(" ");
        try {
          const created = await client.users.createUser({
            emailAddress: [normalizedEmail],
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            publicMetadata: { role: "student" },
          } as any);
          userIdForOrder = created.id;
          createdNewUser = true;
        } catch (e: any) {
          const again = await client.users.getUserList({ emailAddress: [normalizedEmail] } as any);
          if (again.data.length > 0) {
            userIdForOrder = again.data[0].id;
          } else {
            throw e;
          }
        }
      }
    }

    const order = await convex.mutation(api.orders.createOrder, {
      userId: userIdForOrder!,
      status: "pending",
      provider: "paypal",
      totalAmount: pack.price,
      currency: "usd",
    });

    if (!order) {
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    orderId = order._id;

    let baseUrl: string;
    if (process.env.NEXT_PUBLIC_URL) {
      baseUrl = process.env.NEXT_PUBLIC_URL;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
      }
      baseUrl = "http://localhost:3000";
    }

    let paypalOrder;
    try {
      // Build signed cancel URL
      const ts = Date.now().toString();
      const secret = process.env.CANCEL_TOKEN_SECRET;
      const base = `${orderId}:${ts}`;
      const token = secret ? crypto.createHmac("sha256", secret).update(base).digest("hex") : undefined;
      const cancelUrl = token
        ? `${baseUrl}/api/checkout/cancel?order_id=${encodeURIComponent(orderId!)}&ts=${encodeURIComponent(ts)}&token=${encodeURIComponent(token)}`
        : `${baseUrl}/checkout/cancel`;

      paypalOrder = await createPayPalOrder(
        pack.price,
        "usd",
        {
          userId: userIdForOrder!,
          instructorId: pack.instructorId || "",
          productId: packId,
          orderId: JSON.stringify({ orderId: orderId, packId }),
        },
        `${baseUrl}/checkout/success?order_id={ORDER_ID}${createdNewUser ? "&new=1" : ""}`,
        cancelUrl
      );
    } catch (paypalError) {
      if (orderId) {
        try {
          await convex.mutation(api.orders.updateOrder, {
            id: orderId as Id<"orders">,
            status: "failed",
          });
        } catch (updateError) {
          console.error(`Failed to update order ${orderId} to failed:`, updateError);
        }
      }
      throw paypalError;
    }

    return NextResponse.json({ url: paypalOrder.approvalUrl, orderId: paypalOrder.orderId });
  } catch (error) {
    console.error("PayPal checkout error:", error);

    if (orderId) {
      try {
        const convex = getConvexClient();
        await convex.mutation(api.orders.updateOrder, {
          id: orderId as Id<"orders">,
          status: "failed",
        });
        console.log(`Marked orphaned order ${orderId} as failed`);
      } catch (cleanupError) {
        console.error(`Failed to cleanup order ${orderId}:`, cleanupError);
      }
    }

    return NextResponse.json(
      { error: "Checkout failed" },
      { status: 500 }
    );
  }
}
