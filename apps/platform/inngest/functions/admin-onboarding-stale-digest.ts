"use node";

import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(convexUrl);
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;
  if (process.env.VERCEL_URL) return "https://" + process.env.VERCEL_URL;
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set");
  return "http://localhost:3000";
}

const THIRTEEN_DAYS_MS = 13 * 24 * 60 * 60 * 1000;
const STALE_CUTOFF_MS = Date.now() - THIRTEEN_DAYS_MS;

export const adminOnboardingStaleDigestFlow = inngest.createFunction(
  { id: "admin-onboarding-stale-digest", name: "Admin Onboarding Stale Digest", retries: 0 },
  { cron: "0 9 * * *" },
  async ({ step }) => {
    const convex = getConvexClient();
    const baseUrl = getBaseUrl();

    const staleOnboardings = await step.run("scan-stale", async () => {
      const allCompleted = await convex.query(api.adminOnboarding.listAdminOnboardings, { status: "completed", limit: 200 });
      if (!allCompleted || allCompleted.length === 0) return [];
      return allCompleted.filter(function(row: any) {
        if (row.createdAt >= STALE_CUTOFF_MS) return false;
        const hasPlaceholder = row.sessionPackIds && row.sessionPackIds.some(function(spId: string) { return spId.startsWith("email:"); });
        return hasPlaceholder && !row.email.startsWith("clerk:");
      });
    });

    if (staleOnboardings.length === 0) return { processed: 0 };

    await step.run("send-digest", async () => {
      const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art").split(",").map(function(e: string) { return e.trim(); }).filter(Boolean);
      if (adminEmails.length === 0) return;
      const daysPending = function(createdAt: number) { return Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)); };
      const htmlHeader = "<div style=\"font-family:ui-sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827\"><div style=\"font-size:18px;font-weight:700;margin-bottom:12px\">Huckleberry — Stale Onboarding Invites</div><div style=\"padding:16px;border:1px solid #E5E7EB;border-radius:12px\"><div style=\"font-weight:700;margin-bottom:8px\">" + staleOnboardings.length + " invite(s) pending > 13 days</div><p>These students have not accepted their Clerk invite. Placeholder session packs are holding instructor inventory.</p><table style=\"width:100%;border-collapse:collapse\"><thead><tr style=\"border-bottom:1px solid #E5E7EB\"><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Student</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Instructors</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Days</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Link</th></tr></thead><tbody>";
      const htmlRows = staleOnboardings.map(function(row: any) { return "<tr><td style=\"padding:8px\">" + row.email + "</td><td style=\"padding:8px\">" + (row.perInstructor ? row.perInstructor.length : 0) + "</td><td style=\"padding:8px\">" + daysPending(row.createdAt) + "</td><td style=\"padding:8px\"><a href=\"" + baseUrl + "/admin/onboardings/" + row._id + "\">View</a></td></tr>"; }).join("");
      const htmlFooter = "</tbody></table></div></div>";
      const html = htmlHeader + htmlRows + htmlFooter;
      const textLines = [staleOnboardings.length + " stale invite(s) pending > 13 days:"];
      for (const row of staleOnboardings) { textLines.push(row.email + " | " + (row.perInstructor ? row.perInstructor.length : 0) + " instructors | " + daysPending(row.createdAt) + " days | " + baseUrl + "/admin/onboardings/" + row._id); }
      const text = textLines.join("\n");
      for (const adminEmail of adminEmails) {
        sendEmail({ to: adminEmail, subject: "Stale onboarding invites — " + staleOnboardings.length + " pending > 13 days", html, text, headers: { "X-Email-Type": "admin_onboarding_stale_digest" } }).catch(function(e: unknown) {
          reportError({ source: "inngest:admin-onboarding-stale-digest", error: e instanceof Error ? e : new Error(String(e)), level: "error", message: "Failed to send digest to " + adminEmail, context: { ids: staleOnboardings.map(function(r: any) { return r._id; }) } });
        });
      }
    });

    await step.run("release-placeholders", async () => {
      const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
      if (!secret) return;
      for (const row of staleOnboardings) {
        // Note: this only records the "released" event in the timeline.
        // Actual inventory release (cancelling session pack seats, ending workspaces)
        // requires a dedicated Convex mutation — not yet implemented.
        convex.action(api.adminOnboarding.appendTimelineEntryAction, {
          onboardingId: row._id as Id<"adminOnboardings">,
          event: "released",
          actorUserId: undefined,
          details: "stale-invite-digest auto-release: placeholder held > 13 days",
          expectedStatus: "completed",
          secret,
        }).catch(function() { /* best-effort: row may already be in a terminal state */ });
      }
    });

    return { processed: staleOnboardings.length };
  }
);
