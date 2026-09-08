import { Migrations } from "@convex-dev/migrations";
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { resolveSessionWorkspace } from "./lib/sessionWorkspace";

// Central migrations controller. Define individual migrations under `internal.migrations.*`
// and invoke them via the runner below. See @convex-dev/migrations docs for patterns
// like widen-migrate-narrow and resumable batch processing.
export const migrations = new Migrations(components.migrations, {
  internalMutation,
  defaultBatchSize: 50,
  migrationsLocationPrefix: "migrations:",
});

// Generic runner: accepts a migration name at call-time.
// Usage examples:
// - npx convex run migrations:run '{"fn":"migrations:backfillLegacyInstructorRef"}'
// - npx convex run migrations:run '{"fn":"migrations:someOtherMigration"}'
export const run = migrations.runner();

// Backfill legacyInstructorRef from legacyId where missing (widen/migrate step)
export const backfillLegacyInstructorRef = migrations.define({
  table: "instructors",
  migrateOne: async (_ctx, inst: { legacyInstructorRef?: string; legacyId?: string }) => {
    if (inst.legacyInstructorRef === undefined && inst.legacyId !== undefined) {
      return { legacyInstructorRef: inst.legacyId } as Partial<typeof inst>;
    }
  },
});

// Convenient runner bound to the backfill
export const runBackfillLegacyInstructorRef = migrations.runner(internal.migrations.backfillLegacyInstructorRef);

export const backfillSessionWorkspaceLinks = migrations.define({
  table: "sessions",
  migrateOne: async (ctx, session) => {
    const patch: {
      workspaceId?: typeof session.workspaceId;
      hasRecordingArtifact?: boolean;
    } = {};

    if (
      session.hasRecordingArtifact === undefined &&
      (session.recordingUrl !== undefined ||
        session.recordingTransferStatus !== undefined)
    ) {
      patch.hasRecordingArtifact = true;
    }

    if (session.workspaceId === undefined) {
      const workspace = await resolveSessionWorkspace(ctx, session);
      if (workspace) patch.workspaceId = workspace._id;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

export const runBackfillSessionWorkspaceLinks = migrations.runner(
  internal.migrations.backfillSessionWorkspaceLinks
);

// ---------------------------------------------------------------------------
// PR 2 — Migrate: reconcile instructorProfiles against instructors.
//
// Context: before PR #830, overlapping fields lived in both `instructors` and
// `instructorProfiles` and could drift independently. After PR #830, all
// writes go through atomic dual-write helpers, so new divergence is
// impossible — but historical drift still exists.
//
// These migrations are idempotent (no-op when already reconciled) and
// resumable via @convex-dev/migrations.
//
// Invoke order on staging first, then prod:
//   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfilePortfolioImages"}'
//   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfileMetadata"}'
//   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfileImage"}'
// ---------------------------------------------------------------------------

type InstructorProfileRow = {
  _id: import("./_generated/dataModel").Id<"instructorProfiles">;
  slug: string;
  name: string;
  userId?: string;
  legacyInstructorRef?: string;
  email?: string;
  tagline?: string;
  bio?: string;
  specialties?: string[];
  background?: string[];
  socials?: unknown;
  isActive: boolean;
  isNew?: boolean;
  profileImageUrl?: string;
  profileImageStorageId?: string;
  profileImageUploadPath?: string;
  portfolioImages?: string[];
  portfolioImageStorageIds?: string[];
};

type InstructorRow = {
  _id: import("./_generated/dataModel").Id<"instructors">;
  slug?: string;
  name?: string;
  email?: string;
  userId?: string;
  legacyInstructorRef?: string;
  tagline?: string;
  bio?: string;
  specialties?: string[];
  background?: string[];
  socials?: unknown;
  isActive?: boolean;
  isNew?: boolean;
  profileImageUrl?: string;
  profileImageStorageId?: string;
  profileImageUploadPath?: string;
  portfolioImages?: string[];
  portfolioImageStorageIds?: string[];
};

function arraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const ak = Object.keys(aRec).sort();
  const bk = Object.keys(bRec).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqual(aRec[ak[i]], bRec[bk[i]])) return false;
  }
  return true;
}

// Reconcile portfolio images per slug. Union with profile-first order; pair
// storage IDs by finding the URL's index in each side's list, preferring the
// profile's match when both have it.
export const reconcileInstructorProfilePortfolioImages = migrations.define({
  table: "instructorProfiles",
  migrateOne: async (ctx, profile: InstructorProfileRow) => {
    if (!profile.slug) return undefined;
    // Skip soft-deleted instructor rows (Greptile P2 review on PR #831).
    const inst = (await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.eq(q.field("slug"), profile.slug))
      .first()) as InstructorRow | null;

    const profileUrls = profile.portfolioImages ?? [];
    const profileSids = profile.portfolioImageStorageIds ?? [];
    const instructorUrls = inst?.portfolioImages ?? [];
    const instructorSids = inst?.portfolioImageStorageIds ?? [];

    // Union: profile URLs first (preserving order), then unique instructor URLs.
    const union: string[] = [];
    const seen = new Set<string>();
    for (const url of profileUrls) {
      if (url && !seen.has(url)) {
        union.push(url);
        seen.add(url);
      }
    }
    for (const url of instructorUrls) {
      if (url && !seen.has(url)) {
        union.push(url);
        seen.add(url);
      }
    }

    // Pair storage IDs by URL: prefer profile's SID if the URL exists at the
    // matching index on the profile; else fall back to instructor's SID.
    const unionSids: string[] = union.map((url) => {
      const pIdx = profileUrls.indexOf(url);
      if (pIdx !== -1 && profileSids[pIdx]) return profileSids[pIdx];
      const iIdx = instructorUrls.indexOf(url);
      if (iIdx !== -1 && instructorSids[iIdx]) return instructorSids[iIdx];
      return "";
    });

    const profileChanged =
      !arraysEqual(profileUrls, union) || !arraysEqual(profileSids, unionSids);
    const instructorChanged =
      !!inst &&
      (!arraysEqual(instructorUrls, union) || !arraysEqual(instructorSids, unionSids));

    if (!profileChanged && !instructorChanged) return undefined;

    await ctx.db.patch(profile._id, {
      portfolioImages: union,
      portfolioImageStorageIds: unionSids,
    });
    if (inst && instructorChanged) {
      await ctx.db.patch(inst._id, {
        portfolioImages: union,
        portfolioImageStorageIds: unionSids,
        updatedAt: Date.now(),
      });
    }

    return { portfolioImages: union, portfolioImageStorageIds: unionSids };
  },
});

export const runReconcileInstructorProfilePortfolioImages = migrations.runner(
  internal.migrations.reconcileInstructorProfilePortfolioImages
);

// Reconcile the profile image (URL + storage ID). Prefer the storage-backed
// version from whichever side has BOTH a storage ID AND a URL. Otherwise
// fall back to the URL on either side. If only one side has data,
// propagate it to the other.
export const reconcileInstructorProfileImage = migrations.define({
  table: "instructorProfiles",
  migrateOne: async (ctx, profile: InstructorProfileRow) => {
    if (!profile.slug) return undefined;
    // Skip soft-deleted instructor rows (Greptile P2 review on PR #831).
    const inst = (await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.eq(q.field("slug"), profile.slug))
      .first()) as InstructorRow | null;

    // Pick the canonical pair: prefer a side that has BOTH storage ID and
    // URL (a complete storage-backed version). A half-set storage ID with
    // no URL would be useless — fall through to URL-only branches in that
    // case (Greptile P1 review on PR #831).
    let url: string | undefined;
    let sid: string | undefined;
    if (profile.profileImageStorageId && profile.profileImageUrl) {
      sid = profile.profileImageStorageId;
      url = profile.profileImageUrl;
    } else if (inst?.profileImageStorageId && inst.profileImageUrl) {
      sid = inst.profileImageStorageId;
      url = inst.profileImageUrl;
    } else if (profile.profileImageUrl) {
      url = profile.profileImageUrl;
    } else if (inst?.profileImageUrl) {
      url = inst.profileImageUrl;
    }

    const profilePatch: Record<string, string> = {};
    const instructorPatch: Record<string, string | number> = {};
    if (url !== undefined && profile.profileImageUrl !== url) {
      profilePatch.profileImageUrl = url;
    }
    if (sid !== undefined && profile.profileImageStorageId !== sid) {
      profilePatch.profileImageStorageId = sid;
    }
    if (inst && url !== undefined && inst.profileImageUrl !== url) {
      instructorPatch.profileImageUrl = url;
    }
    if (inst && sid !== undefined && inst.profileImageStorageId !== sid) {
      instructorPatch.profileImageStorageId = sid;
    }

    if (Object.keys(profilePatch).length === 0 && Object.keys(instructorPatch).length === 0) {
      return undefined;
    }

    if (Object.keys(profilePatch).length > 0) {
      await ctx.db.patch(profile._id, profilePatch);
    }
    if (inst && Object.keys(instructorPatch).length > 0) {
      instructorPatch.updatedAt = Date.now();
      await ctx.db.patch(inst._id, instructorPatch);
    }

    return profilePatch;
  },
});

export const runReconcileInstructorProfileImage = migrations.runner(
  internal.migrations.reconcileInstructorProfileImage
);

// Reconcile remaining overlapping metadata fields. `instructors` is canonical
// (per AGENTS.md); fall back to `instructorProfiles` when the instructor row
// lacks a value. Patches both rows so they match.
export const reconcileInstructorProfileMetadata = migrations.define({
  table: "instructorProfiles",
  migrateOne: async (ctx, profile: InstructorProfileRow) => {
    if (!profile.slug) return undefined;
    // Skip soft-deleted instructor rows (Greptile P2 review on PR #831 —
    // `by_slug` is non-unique and historical soft-deletes can produce
    // multiple rows for one slug; pick the active one).
    const inst = (await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.eq(q.field("slug"), profile.slug))
      .first()) as InstructorRow | null;

    const fields: Array<keyof InstructorProfileRow> = [
      "userId",
      "legacyInstructorRef",
      "email",
      "tagline",
      "bio",
      "specialties",
      "background",
      "socials",
      "isNew",
      "profileImageUploadPath",
    ];

    const profilePatch: Record<string, unknown> = {};
    const instructorPatch: Record<string, unknown> = {};

    for (const f of fields) {
      const canonical = inst?.[f as keyof InstructorRow] ?? profile[f];
      if (canonical === undefined) continue;

      if (!deepEqual(profile[f], canonical)) {
        profilePatch[f] = canonical;
      }
      if (inst && !deepEqual(inst[f as keyof InstructorRow], canonical)) {
        instructorPatch[f] = canonical;
      }
    }

    // `name` and `isActive` — special-case: the profile table requires both,
    // so they always have a value there. Bidirectional reconciliation:
    // instructor wins when defined; otherwise profile's value propagates
    // back to the instructor (Greptile P1 review on PR #831).
    if (inst?.name !== undefined) {
      if (inst.name !== profile.name) profilePatch.name = inst.name;
    } else if (profile.name) {
      instructorPatch.name = profile.name;
    }
    if (inst?.isActive !== undefined) {
      if (inst.isActive !== profile.isActive) profilePatch.isActive = inst.isActive;
    } else {
      instructorPatch.isActive = profile.isActive;
    }

    if (Object.keys(profilePatch).length === 0 && Object.keys(instructorPatch).length === 0) {
      return undefined;
    }

    await ctx.db.patch(profile._id, profilePatch);
    if (inst && Object.keys(instructorPatch).length > 0) {
      instructorPatch.updatedAt = Date.now();
      await ctx.db.patch(inst._id, instructorPatch);
    }

    return profilePatch;
  },
});

export const runReconcileInstructorProfileMetadata = migrations.runner(
  internal.migrations.reconcileInstructorProfileMetadata
);
