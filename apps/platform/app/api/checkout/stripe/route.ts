import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { stripe } from "@/lib/stripe";
import crypto from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { sendEmailLinkForUser } from "@/lib/clerk-magic-links";
import { sendEmail } from "@/lib/email";

function getConvexClient() {
  // Prefer public URL; fall back to server-only CONVEX_URL to avoid hard failures
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set");
  }
  return new ConvexHttpClient(convexUrl);
}

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  promotionCode: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    const rawBody = await req.json();
    // Minimal compatibility: accept either `packId` or `productId`
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? {
            packId: rawBody.packId ?? rawBody.productId,
            email: rawBody.email,
            fullName: rawBody.fullName,
            promotionCode: rawBody.promotionCode,
          }
        : rawBody;

    const validationResult = checkoutSchema.safeParse(body as unknown);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { packId, promotionCode, email, fullName } = validationResult.data;
    const convex = getConvexClient();

    // Use public product lookup to support guest checkout
    const pack = await convex.query(api.products.getPublicProductById, {
      id: packId as Id<"products">,
    });

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    if (!pack.stripePriceId) {
      return NextResponse.json(
        { error: "Stripe price ID not configured for this pack" },
        { status: 400 }
      );
    }

    let finalPrice = pack.price;

    // Resolve user: if authenticated, use that userId; otherwise upsert by email
    // Try Clerk auth; if it fails (e.g., SDK validation 422), proceed as guest
    let authedUserId: string | null = null;
    try {
      const authRes = await auth();
      authedUserId = authRes?.userId ?? null;
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      const code = e?.code ?? (typeof e?.message === "string" ? e.message : undefined);
      try {
        console.error("Clerk auth failed; proceeding as guest", { status, code });
      } catch {}
      authedUserId = null;
    }
    let userIdForOrder: string | null = authedUserId ?? null;
    let customerEmail: string | undefined = undefined;

    let createdNewUser = false;
    if (!userIdForOrder) {
      if (!email || !fullName) {
        return NextResponse.json(
          { error: "Email and full name are required" },
          { status: 400 }
        );
      }

      // Normalize email to avoid duplicate accounts for the same mailbox
      const normalizedEmail = email.trim().toLowerCase();
      customerEmail = normalizedEmail;

      try {
        const client = await clerkClient();
        // Try to find existing user by email
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
              // Mark as a student in public metadata if used by the app
              publicMetadata: { role: "student" },
              // Allow creation without password in instances that require passwords
              // so we can complete guest checkout and send a magic link
              skipPasswordRequirement: true,
            } as any);
            userIdForOrder = created.id;
            createdNewUser = true;
          } catch (e: any) {
            // If user already exists due to a race, fetch again and proceed
            const again = await client.users.getUserList({ emailAddress: [normalizedEmail] } as any);
            if (again.data.length > 0) {
              userIdForOrder = again.data[0].id;
            } else {
              // Any other Clerk error (including 422 form_data_missing): fallback to guest
              const status = e?.status ?? e?.statusCode;
              const code = e?.code ?? (typeof e?.message === "string" ? e.message : undefined);
              try {
                console.error("Clerk create/find user failed; proceeding as guest", {
                  status,
                  code,
                });
              } catch {}
              userIdForOrder = "guest";
              createdNewUser = false;
            }
          }
        }
      } catch (e: any) {
        // If even getUserList fails (e.g., 422 or config), proceed as guest
        const status = e?.status ?? e?.statusCode;
        const code = e?.code ?? (typeof e?.message === "string" ? e.message : undefined);
        try {
          console.error("Clerk user lookup failed; proceeding as guest", { status, code });
        } catch {}
        userIdForOrder = "guest";
        createdNewUser = false;
      }
    }

    const order = await convex.mutation(api.orders.createOrder, {
      userId: userIdForOrder!,
      status: "pending",
      provider: "stripe",
      totalAmount: finalPrice,
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

    const discounts: Array<{ coupon?: string; promotion_code?: string }> = [];

    if (promotionCode) {
      discounts.push({ promotion_code: promotionCode });
    }

    let session: Stripe.Checkout.Session;
    try {
      const ts = Date.now().toString();
      const secret = process.env.CANCEL_TOKEN_SECRET;
      const base = `${orderId}:${ts}`;
      const token = secret ? crypto.createHmac("sha256", secret).update(base).digest("hex") : undefined;
      const cancelUrl = token
        ? `${baseUrl}/api/checkout/cancel?order_id=${encodeURIComponent(orderId!)}&ts=${encodeURIComponent(ts)}&token=${encodeURIComponent(token)}`
        : `${baseUrl}/checkout/cancel`;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        line_items: [
          {
            price: pack.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}${createdNewUser ? "&new=1" : ""}${userIdForOrder === "guest" ? "&guest=1" : ""}`,
        cancel_url: cancelUrl,
        metadata: {
          order_id: orderId!,
          user_id: userIdForOrder!,
          pack_id: packId,
        },
        allow_promotion_codes: discounts.length === 0,
      };

      if (discounts.length > 0) {
        sessionParams.discounts = discounts;
      }

      if (customerEmail) {
        sessionParams.customer_email = customerEmail;
      }

      session = await stripe.checkout.sessions.create(sessionParams);

      // Fire-and-forget: send email-link sign-in for Clerk users (new or existing)
      if (userIdForOrder && userIdForOrder !== "guest") {
        // Use the same baseUrl used for success/cancel URLs
        // Redirect path centralizes role-based landing in /auth-redirect
        void sendEmailLinkForUser(userIdForOrder, `${baseUrl}/auth-redirect`).catch((e) => {
          console.error("[stripe] Failed to send magic link:", e);
        });
      }

      // If we couldn't create a Clerk user and fell back to guest, send a guest onboarding email now
      if (!createdNewUser && userIdForOrder === "guest" && customerEmail) {
        const claimUrl = `${baseUrl}/sign-up`;
        const dashboardUrl = `${baseUrl}/dashboard`;
        const html = `
          <div style="font-family:Arial,sans-serif;color:#111">
            <h2 style="margin:0 0 12px">You're in! Claim your account</h2>
            <p style="margin:0 0 12px">We created your purchase using this email. Create your account to link it now and access your session pack anytime.</p>
            <p style="margin:0 0 16px"><a href="${claimUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Claim your account</a></p>
            <p style="margin:0 0 8px">Already have an account? <a href="${baseUrl}/sign-in">Sign in</a>.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
            <p style="margin:0 0 8px">Once signed in, head to your dashboard:</p>
            <p style="margin:0"><a href="${dashboardUrl}">${dashboardUrl}</a></p>
            <p style="color:#6b7280;margin-top:12px;font-size:12px">Tip: Use the same email (${customerEmail}) to automatically link your purchase.</p>
          </div>`;
        void sendEmail({
          to: customerEmail,
          subject: "Claim your account to access your session pack",
          html,
          headers: { "X-Email-Type": "guest_onboarding", "X-Provider": "stripe" },
        }).catch((e) => console.error("[stripe] Guest onboarding email failed/skipped:", e));
      }
    } catch (stripeError) {
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
      throw stripeError;
    }

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    // Prefer Clerk 422 details when available; otherwise sanitized logging
    const isClerkErr = (err: unknown): err is {
      clerkError: true;
      status?: number;
      code?: string;
      clerkTraceId?: string;
      errors?: Array<unknown>;
    } => {
      if (typeof err !== "object" || err === null) return false;
      if (!("clerkError" in err)) return false;
      const val = (err as { clerkError?: unknown }).clerkError;
      return typeof val === "boolean" && val === true;
    };

    const sanitize = (errors: Array<unknown> | undefined) => {
      if (!Array.isArray(errors)) return [] as Array<{ code: string | null; type: string | null }>;
      return errors.map((e) => {
        if (e && typeof e === "object") {
          let code: string | null = null;
          let type: string | null = null;
          if ("code" in (e as object) && typeof (e as any).code === "string") code = (e as any).code;
          if ("type" in (e as object) && typeof (e as any).type === "string") type = (e as any).type;
          return { code, type };
        }
        return { code: null, type: null };
      });
    };

    if (isClerkErr(error) && error.status === 422) {
      const details = sanitize(error.errors);
      try {
        console.error("Clerk API error details:", {
          status: error.status,
          code: error.code,
          clerkTraceId: error.clerkTraceId,
          errors: details,
        });
      } catch {}

      if (orderId) {
        try {
          const convex = getConvexClient();
          await convex.mutation(api.orders.updateOrder, {
            id: orderId as Id<"orders">,
            status: "failed",
          });
        } catch (cleanupError) {
          console.error(`Failed to cleanup order ${orderId}:`, cleanupError);
        }
      }

      return NextResponse.json(
        { error: "User creation failed", code: error.code ?? "clerk_error", details },
        { status: 422 }
      );
    }

    try {
      const status = (error as any)?.status ?? (error as any)?.statusCode;
      const code = (error as any)?.code ?? (typeof (error as any)?.message === "string" ? (error as any).message : undefined);
      console.error("Checkout error:", { status, code });
    } catch {
      console.error("Checkout error (raw):", error);
    }

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

    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
