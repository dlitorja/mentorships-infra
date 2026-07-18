"use node";

import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import {
  paginateStaleOnboardings,
  DEFAULT_STALE_MAX_ROWS,
  DEFAULT_STALE_PAGE_SIZE,
} from "@/lib/paginate-stale-onboardings";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(convexUrl);
}

/**
 * PR 4 fix: HTML-escape user-supplied values before inserting them
 * into the admin digest HTML. Mirrors the convention used by every
 * other email builder in this codebase (purchase, refund, booking,
 * notification, instructor-onboarding, admin-purchase-notification).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;
  if (process.env.VERCEL_URL) return "https://" + process.env.VERCEL_URL;
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set");
  return "http://localhost:3000";
}

const THIRTEEN_DAYS_MS = 13 * 24 * 60 * 60 * 1000;

export const adminOnboardingStaleDigestFlow = inngest.createFunction(
  { id: "admin-onboarding-stale-digest", name: "Admin Onboarding Stale Digest", retries: 0 },
  { cron: "0 9 * * *" },
  async ({ step }) => {
    const convex = getConvexClient();
    const baseUrl = getBaseUrl();

    const scanResult = await step.run("scan-stale", async () => {
      // PR 4 fix: compute the cutoff INSIDE the step so a warm Lambda
      // doesn't drift toward "13 days after cold start".
      const staleCutoffMs = Date.now() - THIRTEEN_DAYS_MS;
      // PR 4 cloud-review fix (CodeRabbit #9204): throw on missing secret
      // instead of silently returning []. A misconfigured deployment must
      // not look like "no stale invites found" — monitoring should detect
      // this immediately via the failure.
      const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
      if (!secret) throw new Error("CONVEX_SERVER_SHARED_SECRET is not set; admin-onboarding-stale-digest cannot authenticate against Convex");
      // PR 4 cloud-review fix (CodeRabbit #9210 + #9214): delegate the
      // ownership-aware scan to a single Convex action. Server-side
      // verifies each placeholder pack is still owned by an "email:"
      // placeholder (not already claimed by a real Clerk user).
      //
      // R3 (PR 7): iterate pages via `paginateStaleOnboardings`. The
      // helper bounds the scan at 10,000 rows per run as a safety cap;
      // the remaining tail surfaces as `truncated: true` so monitoring
      // can catch a sustained backlog (and the next cron run picks it up).
      return await paginateStaleOnboardings(
        async (cursor, numItems) =>
          convex.action(api.adminOnboarding.getStaleOnboardingsAction, {
            cutoffMs: staleCutoffMs,
            paginationOpts: { numItems, cursor },
            secret,
          })
      );
    });

    const staleOnboardings = scanResult.rows;

    // R3 (PR 7): if the scan hit the safety cap with more rows remaining,
    // surface a monitoring event so on-call sees the unprocessed tail.
    if (scanResult.truncated) {
      reportError({
        source: "inngest:admin-onboarding-stale-digest",
        error: new Error("Stale-onboarding scan truncated at " + DEFAULT_STALE_MAX_ROWS + " rows; remaining tail will be processed by the next cron run"),
        level: "error",
        message: "Stale-onboarding scan truncated at " + DEFAULT_STALE_MAX_ROWS + " rows",
        context: {
          totalRequested: scanResult.totalRequested,
          returnedRows: scanResult.rows.length,
          pageSize: DEFAULT_STALE_PAGE_SIZE,
          maxRows: DEFAULT_STALE_MAX_ROWS,
        },
      });
    }

    if (staleOnboardings.length === 0) return { processed: 0, truncated: scanResult.truncated };

    await step.run("send-digest", async () => {
      const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art").split(",").map(function(e: string) { return e.trim(); }).filter(Boolean);
      if (adminEmails.length === 0) return;
      const daysPending = function(createdAt: number) { return Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)); };
      const htmlHeader = "<div style=\"font-family:ui-sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827\"><div style=\"font-size:18px;font-weight:700;margin-bottom:12px\">Huckleberry — Stale Onboarding Invites</div><div style=\"padding:16px;border:1px solid #E5E7EB;border-radius:12px\"><div style=\"font-weight:700;margin-bottom:8px\">" + staleOnboardings.length + " invite(s) pending > 13 days</div><p>These students have not accepted their Clerk invite. Placeholder session packs are holding instructor inventory.</p><table style=\"width:100%;border-collapse:collapse\"><thead><tr style=\"border-bottom:1px solid #E5E7EB\"><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Student</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Instructors</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Days</th><th style=\"text-align:left;padding:8px;color:#6B7280;font-size:12px\">Link</th></tr></thead><tbody>";
      const htmlRows = staleOnboardings.map(function(row: any) { return "<tr><td style=\"padding:8px\">" + escapeHtml(row.email) + "</td><td style=\"padding:8px\">" + (row.perInstructor ? row.perInstructor.length : 0) + "</td><td style=\"padding:8px\">" + daysPending(row.createdAt) + "</td><td style=\"padding:8px\"><a href=\"" + escapeHtml(baseUrl + "/admin/onboardings/" + row._id) + "\">View</a></td></tr>"; }).join("");
      const htmlFooter = "</tbody></table></div></div>";
      const html = htmlHeader + htmlRows + htmlFooter;
      const textLines = [staleOnboardings.length + " stale invite(s) pending > 13 days:"];
      for (const row of staleOnboardings) { textLines.push(row.email + " | " + (row.perInstructor ? row.perInstructor.length : 0) + " instructors | " + daysPending(row.createdAt) + " days | " + baseUrl + "/admin/onboardings/" + row._id); }
      const text = textLines.join("\n");
      // PR 4 fix: await each sendEmail so the step only resolves after all
      // sends have completed. Errors are caught per-recipient so a single
      // failure doesn't abort the entire digest.
      // PR 4 cloud-review fix (CodeRabbit #9221): also report when
      // `sendEmail` returns `ok: false` (provider accepted the request but
      // the delivery itself failed) — without this, only thrown exceptions
      // were reported.
      await Promise.all(adminEmails.map(async function(adminEmail: string) {
        try {
          const res = await sendEmail({ to: adminEmail, subject: "Stale onboarding invites — " + staleOnboardings.length + " pending > 13 days", html, text, headers: { "X-Email-Type": "admin_onboarding_stale_digest" } });
          if (!res.ok) {
            reportError({
              source: "inngest:admin-onboarding-stale-digest",
              error: new Error("sendEmail returned ok:false: " + ("error" in res ? res.error : "skipped" in res ? res.reason : "unknown")),
              level: "error",
              message: "sendEmail reported non-ok result for digest recipient " + adminEmail,
              context: { ids: staleOnboardings.map(function(r: any) { return r._id; }) },
            });
          }
        } catch (e: unknown) {
          reportError({ source: "inngest:admin-onboarding-stale-digest", error: e instanceof Error ? e : new Error(String(e)), level: "error", message: "Failed to send digest to " + adminEmail, context: { ids: staleOnboardings.map(function(r: any) { return r._id; }) } });
        }
      }));
    });

    await step.run("release-placeholders", async () => {
      // PR 4 cloud-review fix (CodeRabbit #9204): throw on missing secret
      // here too, mirroring the scan-stale behavior. Better to fail the
      // scheduled cron than to silently skip releasing inventory.
      const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
      if (!secret) throw new Error("CONVEX_SERVER_SHARED_SECRET is not set; admin-onboarding-stale-digest cannot release placeholder inventory");
      // PR 16 (R11) consolidation: one batched Convex transaction per chunk
      // instead of N per-row actions. The batch mutation handles per-row
      // errors internally (catches + skips + logs) and returns the
      // `failedOnboardingIds` list so we can surface each row's failure
      // through the existing observability path (matches the pre-PR-16
      // per-row `reportError` behavior).
      //
      // Chunk at 20 onboarding IDs per call (PR 16 follow-up: Greptile
      // flagged that batch size should account for variable per-row work
      // — each onboarding has up to N perInstructor entries, each
      // touching 3 inventory records + a timeline append. Bounding at
      // 20 onboarding IDs keeps even worst-case per-instructor counts
      // safely under Convex mutation read/write limits.)
      const BATCH_SIZE = 20;
      for (let i = 0; i < staleOnboardings.length; i += BATCH_SIZE) {
        const chunk = staleOnboardings.slice(i, i + BATCH_SIZE);
        try {
          const result = await convex.action(api.adminOnboarding.releasePlaceholderInventoryBatchAction, {
            onboardingIds: chunk.map(function(row: any) { return row._id as Id<"adminOnboardings">; }),
            actorUserId: undefined,
            details: "stale-invite-digest auto-release: placeholder held > 13 days",
            secret,
          });
          // Surface per-row failures through the existing observability
          // path — the batch mutation caught them internally so we have
          // to forward them explicitly. One `reportError` per failed
          // onboarding ID so on-call can correlate with the original
          // stale-digest scan.
          if (result && Array.isArray(result.failedOnboardingIds)) {
            for (const failedId of result.failedOnboardingIds) {
              reportError({
                source: "inngest:admin-onboarding-stale-digest",
                error: new Error("releasePlaceholderInventoryBatchInternal reported per-row failure for " + failedId),
                level: "error",
                message: "Failed to release placeholder inventory for stale onboarding " + failedId,
                context: { onboardingId: failedId },
              });
            }
          }
        } catch (e: unknown) {
          reportError({
            source: "inngest:admin-onboarding-stale-digest",
            error: e instanceof Error ? e : new Error(String(e)),
            level: "error",
            message: "Batch release-placeholder-inventory failed for stale onboardings chunk starting at index " + i,
            context: { chunkStartIndex: i, chunkSize: chunk.length, onboardingIds: chunk.map(function(row: any) { return row._id; }) },
          });
        }
      }
    });

    return { processed: staleOnboardings.length, truncated: scanResult.truncated };
  }
);
