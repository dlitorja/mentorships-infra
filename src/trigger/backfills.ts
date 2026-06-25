import { task, logger } from "@trigger.dev/sdk";
import { db } from "../../packages/db/src/lib/drizzle";
import {
  sql,
} from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

async function callConvexAction(actionPath: string, args: Record<string, unknown>): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }

  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}/api/${actionPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex action failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function callConvexQuery(queryPath: string, args: Record<string, unknown>): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }

  const url = new URL(`${CONVEX_DEPLOYMENT_URL}/api/${queryPath}`);
  Object.entries(args).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex query failed: ${response.status} ${text}`);
  }

  return response.json();
}

// Convex is the source of truth. This task backfills Postgres analytics/helper columns
// without guessing ambiguous mappings. It only writes when values are NULL and the source is deterministic.
export const backfillConvexAndInstructorIds = task({
  id: "backfill-convex-and-instructor-ids",
  retry: { maxAttempts: 5, factor: 1.8, minTimeoutInMs: 1000, maxTimeoutInMs: 15000 },
  maxDuration: 1800,
  run: async () => {
    const results = {
      sessionsInstructorId: 0,
      onboardingInstructorId: 0,
      seatReservationsInstructorId: 0,
    };

    // 1) sessions.instructor_id (uuid) <- session_packs.instructor_id (uuid stored as text)
    {
      const execResult = await db.execute(sql`
        UPDATE public.sessions s
        SET instructor_id = sp.instructor_id::uuid
        FROM public.session_packs sp
        WHERE s.session_pack_id = sp.id
          AND s.instructor_id IS NULL
          AND sp.instructor_id IS NOT NULL;
      ` as any);
      results.sessionsInstructorId = Number((execResult as any).rowCount ?? (execResult as any).count ?? 0);
      logger.info("Backfill sessions.instructor_id from session_packs", results);
    }

    // 2) student_onboarding_submissions.instructor_id (uuid) <- session_packs.instructor_id (uuid stored as text)
    {
      const execResult = await db.execute(sql`
        UPDATE public.student_onboarding_submissions sos
        SET instructor_id = sp.instructor_id::uuid
        FROM public.session_packs sp
        WHERE sos.session_pack_id = sp.id
          AND sos.instructor_id IS NULL
          AND sp.instructor_id IS NOT NULL;
      ` as any);
      results.onboardingInstructorId = Number((execResult as any).rowCount ?? (execResult as any).count ?? 0);
      logger.info("Backfill student_onboarding_submissions.instructor_id from session_packs", results);
    }

    // 3) seat_reservations.instructor_id (text) <- instructor_integrations.id via session_packs -> instructors -> instructor_integrations
    // Chain: sr.session_pack_id = sp.id -> sp.instructor_id::uuid = instructors.id -> instructors.user_id = instructor_integrations.user_id -> set sr.instructor_id = instructor_integrations.id
    {
      const execResult = await db.execute(sql`
        UPDATE public.seat_reservations sr
        SET instructor_id = ii.id
        FROM public.session_packs sp
        JOIN public.instructors i ON i.id = sp.instructor_id::uuid
        JOIN LATERAL (
          SELECT id FROM public.instructor_integrations
          WHERE user_id = i.user_id
          ORDER BY id
          LIMIT 1
        ) ii ON true
        WHERE sr.session_pack_id = sp.id
          AND sr.instructor_id IS NULL
          AND sp.instructor_id IS NOT NULL;
      ` as any);
      results.seatReservationsInstructorId = Number((execResult as any).rowCount ?? (execResult as any).count ?? 0);
      logger.info("Backfill seat_reservations.instructor_id via instructor_integrations", results);
    }

    // Note: We intentionally DO NOT backfill session_packs.convex_id or seat_reservations.convex_id
    // until those columns and a deterministic mapping are present in the live schema.

    return { ok: true, ...results };
  },
});

export const migrateWorkspaceImagesToStorage = task({
  id: "migrate-workspace-images-to-storage",
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000 },
  maxDuration: 3600,
  run: async () => {
    logger.info("Starting workspace images migration to Convex storage");

    if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
      throw new Error("Convex not configured");
    }

    const queryResponse = await fetch(
      `${CONVEX_DEPLOYMENT_URL}/api/workspaces/getImagesNeedingMigration`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
      }
    );

    if (!queryResponse.ok) {
      const text = await queryResponse.text();
      throw new Error(`Query failed: ${queryResponse.status} ${text}`);
    }

    const queryResult = await queryResponse.json() as Array<{
      _id: string;
      workspaceId: string;
      imageUrl: string;
      createdBy: string;
    }>;

    const imagesResult = queryResult || [];

    if (imagesResult.length === 0) {
      logger.info("No images need migration");
      return { ok: true, migrated: 0, skipped: 0 };
    }

    logger.info(`Found ${imagesResult.length} images needing migration`);

    const results = { migrated: 0, failed: 0, skipped: 0 };

    for (const img of imagesResult) {
      try {
        const actionResponse = await fetch(
          `${CONVEX_DEPLOYMENT_URL}/api/workspaces/migrateWorkspaceImage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
            },
            body: JSON.stringify({ imageId: img._id }),
          }
        );

        if (!actionResponse.ok) {
          const text = await actionResponse.text();
          throw new Error(`Action failed: ${actionResponse.status} ${text}`);
        }

        const result = await actionResponse.json() as { success: boolean; reason?: string };

        if (result.success) {
          if (result.reason === "already_migrated") {
            results.skipped++;
            logger.info(`Image ${img._id} already migrated, skipping`);
          } else {
            results.migrated++;
            logger.info(`Migrated image ${img._id}`);
          }
        } else {
          results.skipped++;
          logger.info(`Image ${img._id} skipped: ${result.reason}`);
        }
      } catch (error) {
        results.failed++;
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to migrate image ${img._id}: ${msg}`);
      }
    }

    logger.info("Migration complete", results);

    if (results.failed > 0) {
      throw new Error(`Migration completed with ${results.failed} failures: migrated=${results.migrated}, failed=${results.failed}, skipped=${results.skipped}`);
    }

    return { ok: true, ...results };
  },
});
