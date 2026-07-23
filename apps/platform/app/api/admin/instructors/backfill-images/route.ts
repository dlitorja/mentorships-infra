import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { convexServerCall } from "@/lib/convex-server-call";

export const runtime = "nodejs";

/**
 * POST /api/admin/instructors/backfill-images
 * Body: { baseUrl?: string; includeStudentResults?: boolean; dryRun?: boolean; limit?: number }
 * Requires admin. Triggers Convex action to backfill storage-backed images for instructors, profiles, and student results.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const schema = z.object({
      baseUrl: z.string().trim().min(1).optional(),
      includeStudentResults: z.coerce.boolean().optional(),
      dryRun: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().positive().optional(),
    });

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const rawBase = parsed.data.baseUrl ?? process.env.NEXT_PUBLIC_URL ?? req.headers.get("origin") ?? "";
    let baseUrl: string;
    try {
      baseUrl = new URL(rawBase, req.nextUrl.origin).origin;
    } catch {
      baseUrl = req.nextUrl.origin;
    }
    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required (set NEXT_PUBLIC_URL or pass in body)" }, { status: 400 });
    }
    const includeStudentResults = parsed.data.includeStudentResults ?? true;
    const dryRun = parsed.data.dryRun ?? false;
    const limit = parsed.data.limit;

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });
    }
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Convex recognizes this user as admin (idempotent)
    try {
      const seedClient = new ConvexHttpClient(convexUrl);
      seedClient.setAuth(token);
      await seedClient.mutation(api.users.syncUser, {} as any);
      if (clerkAuth.userId) {
        await convexServerCall("/users/set-role", {
          userId: clerkAuth.userId,
          role: "admin",
        });
      }
    } catch (e) {
      // Non-fatal; admin role might already be set
      console.warn("Convex admin role seed failed:", e);
    }

    // Inline backfill to avoid requiring a deployed Convex action
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);

    type Summary = {
      processedProfiles: number;
      processedInstructors: number;
      processedPortfolioImages: number;
      processedStudentResults: number;
      skipped: number;
      errors: Array<{ kind: string; id: string; message: string }>;
    };

    const summary: Summary = {
      processedProfiles: 0,
      processedInstructors: 0,
      processedPortfolioImages: 0,
      processedStudentResults: 0,
      skipped: 0,
      errors: [],
    };

    const abs = (u?: string) => {
      if (!u) return undefined;
      try {
        const full = new URL(u, baseUrl);
        return full.href;
      } catch {
        return undefined;
      }
    };

    const contentTypeForPath = (p: string) => {
      const s = p.toLowerCase();
      if (s.endsWith(".png")) return "image/png";
      if (s.endsWith(".webp")) return "image/webp";
      if (s.endsWith(".gif")) return "image/gif";
      if (s.endsWith(".svg") || s.endsWith(".svgz")) return "image/svg+xml";
      return "image/jpeg";
    };

    const uploadFromUrl = async (src: string) => {
      try {
        const r = await fetch(src);
        if (!r.ok) return { error: `GET ${r.status}` } as const;
        const buf = await r.arrayBuffer();
        const postUrl = await client.mutation(api.instructors.generateInstructorUploadUrl, {} as any);
        const ct = contentTypeForPath(src);
        const up = await fetch(postUrl, { method: "POST", headers: { "Content-Type": ct }, body: buf });
        if (!up.ok) return { error: `POST ${up.status}` } as const;
        const { storageId } = await up.json() as { storageId: string };
        const url = (await client.query(api.instructors.getStorageUrl, { storageId } as any)) ?? `convex://storage/${storageId}`;
        return { storageId, url } as const;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) } as const;
      }
    };

    // Admin-protected lists
    const [profiles, instructors] = await Promise.all([
      client.query(api.instructors.listInstructorProfilesInternal, {} as any),
      client.query(api.instructors.listInstructorsInternal, {} as any),
    ]);
    const bySlug = new Map<string, any>();
    for (const inst of instructors as any[]) {
      if (inst.slug) bySlug.set(inst.slug, inst);
    }

    let processed = 0;
    const max = typeof limit === "number" ? limit : Number.POSITIVE_INFINITY;

    // Profiles and portfolios
    for (const profile of profiles as any[]) {
      if (processed >= max) break;
      const slug = profile.slug as string | undefined;
      try {
        const inst = slug ? bySlug.get(slug) : undefined;
        // profile image
        if (!profile.profileImageStorageId && profile.profileImageUrl) {
          const src = abs(profile.profileImageUrl);
          if (src && !dryRun) {
            const u = await uploadFromUrl(src);
            if ("error" in u) {
              summary.errors.push({ kind: "profile", id: slug || "unknown", message: `upload failed for ${src}: ${u.error}` });
            } else {
              await client.mutation(api.instructors.updateInstructorProfileStorageIdForProfile, {
                slug,
                storageId: u.storageId,
                url: u.url,
              } as any);
              if (inst?._id) {
                await client.mutation(api.instructors.updateInstructorProfileStorageId, {
                  instructorId: inst._id,
                  storageId: u.storageId,
                  url: u.url,
                } as any);
                summary.processedInstructors++;
              }
              summary.processedProfiles++;
            }
          }
          processed++;
        }

        // portfolio images
        const urls: string[] = (profile.portfolioImages ?? []) as string[];
        const sids: string[] = (profile.portfolioImageStorageIds ?? []) as string[];
        const idxs = urls.map((_, i) => i).filter((i) => !sids[i] && urls[i]);
        if (idxs.length > 0) {
          const newUrls = [...urls];
          const newSids = [...sids];
          for (const i of idxs) {
            if (processed >= max) break;
            const src = abs(urls[i]);
            if (src && !dryRun) {
              const u = await uploadFromUrl(src);
              if ("error" in u) {
                summary.errors.push({ kind: "portfolio", id: `${slug || "unknown"}[${i}]`, message: `upload failed for ${src}: ${u.error}` });
              } else {
                newUrls[i] = u.url;
                newSids[i] = u.storageId;
                summary.processedPortfolioImages++;
              }
            }
            processed++;
          }
          if (!dryRun && idxs.length > 0) {
            await client.mutation(api.instructors.updateInstructorPortfolioStorageIdsForProfile, {
              slug,
              storageIds: newSids,
              urls: newUrls,
            } as any);
            if (inst?._id) {
              await client.mutation(api.instructors.updateInstructorPortfolioStorageIds, {
                instructorId: inst._id,
                storageIds: newSids,
                urls: newUrls,
              } as any);
            }
          }
        }
      } catch (e) {
        summary.errors.push({ kind: "profile", id: slug || "unknown", message: e instanceof Error ? e.message : String(e) });
        summary.skipped++;
      }
    }

    if (includeStudentResults) {
      const results = await client.query(api.instructors.listStudentResultsInternal, {} as any);
      for (const r of results as any[]) {
        if (processed >= max) break;
        try {
          if (!r.imageStorageId && r.imageUrl) {
            const src = abs(r.imageUrl);
            if (src && !dryRun) {
              const u = await uploadFromUrl(src);
              if ("error" in u) {
                summary.errors.push({ kind: "studentResult", id: r._id, message: `upload failed for ${src}: ${u.error}` });
              } else {
                await client.mutation(api.instructors.updateStudentResultStorageId, {
                  studentResultId: r._id,
                  storageId: u.storageId,
                  url: u.url,
                } as any);
                summary.processedStudentResults++;
              }
            }
            processed++;
          }
        } catch (e) {
          summary.errors.push({ kind: "studentResult", id: r._id, message: e instanceof Error ? e.message : String(e) });
          summary.skipped++;
        }
      }
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Unauthorized") || error.message.includes("Forbidden") || error.message.includes("Admin role required"))
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("Unauthorized") ? 401 : 403 }
      );
    }
    console.error("Backfill images error:", error);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
