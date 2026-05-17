import { task, logger } from "@trigger.dev/sdk";
import { db } from "../../packages/db/src/lib/drizzle";
import {
  sql,
} from "../../packages/db/src/schema";

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
