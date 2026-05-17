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
      sessionPacksConvexIdFromPayments: 0,
      sessionPacksConvexIdFromOrders: 0,
      sessionsInstructorId: 0,
      onboardingInstructorId: 0,
      seatReservationsInstructorId: 0,
    };

    // 1) session_packs.convex_id <- payments.convex_id
    // Safe: session_packs.payment_id -> payments.id, copy if payments.convex_id is not null
    {
      const { rowsAffected } = await db.execute(sql`
        UPDATE public.session_packs sp
        SET convex_id = p.convex_id
        FROM public.payments p
        WHERE sp.payment_id = p.id
          AND sp.convex_id IS NULL
          AND p.convex_id IS NOT NULL;
      ` as any);
      results.sessionPacksConvexIdFromPayments = Number(rowsAffected ?? 0);
      logger.info("Backfill session_packs.convex_id from payments", results);
    }

    // 2) session_packs.convex_id <- orders.convex_id (via payments.order_id)
    {
      const { rowsAffected } = await db.execute(sql`
        UPDATE public.session_packs sp
        SET convex_id = o.convex_id
        FROM public.payments p
        JOIN public.orders o ON o.id = p.order_id
        WHERE sp.payment_id = p.id
          AND sp.convex_id IS NULL
          AND o.convex_id IS NOT NULL;
      ` as any);
      results.sessionPacksConvexIdFromOrders = Number(rowsAffected ?? 0);
      logger.info("Backfill session_packs.convex_id from orders", results);
    }

    // 3) sessions.instructor_id (uuid) <- session_packs.instructor_id (uuid stored as text)
    {
      const { rowsAffected } = await db.execute(sql`
        UPDATE public.sessions s
        SET instructor_id = sp.instructor_id::uuid
        FROM public.session_packs sp
        WHERE s.session_pack_id = sp.id
          AND s.instructor_id IS NULL
          AND sp.instructor_id IS NOT NULL;
      ` as any);
      results.sessionsInstructorId = Number(rowsAffected ?? 0);
      logger.info("Backfill sessions.instructor_id from session_packs", results);
    }

    // 4) student_onboarding_submissions.instructor_id (uuid) <- session_packs.instructor_id (uuid stored as text)
    {
      const { rowsAffected } = await db.execute(sql`
        UPDATE public.student_onboarding_submissions sos
        SET instructor_id = sp.instructor_id::uuid
        FROM public.session_packs sp
        WHERE sos.session_pack_id = sp.id
          AND sos.instructor_id IS NULL
          AND sp.instructor_id IS NOT NULL;
      ` as any);
      results.onboardingInstructorId = Number(rowsAffected ?? 0);
      logger.info("Backfill student_onboarding_submissions.instructor_id from session_packs", results);
    }

    // 5) seat_reservations.instructor_id (text) <- instructor_integrations.id via session_packs -> instructors -> instructor_integrations
    // Chain: sr.session_pack_id = sp.id -> sp.instructor_id::uuid = instructors.id -> instructors.user_id = instructor_integrations.user_id -> set sr.instructor_id = instructor_integrations.id
    {
      const { rowsAffected } = await db.execute(sql`
        UPDATE public.seat_reservations sr
        SET instructor_id = ii.id
        FROM public.session_packs sp
        JOIN public.instructors i ON i.id = sp.instructor_id::uuid
        JOIN public.instructor_integrations ii ON ii.user_id = i.user_id
        WHERE sr.session_pack_id = sp.id
          AND sr.instructor_id IS NULL;
      ` as any);
      results.seatReservationsInstructorId = Number(rowsAffected ?? 0);
      logger.info("Backfill seat_reservations.instructor_id via instructor_integrations", results);
    }

    // Note: We intentionally DO NOT backfill seat_reservations.convex_id without a reliable key.
    // If/when a deterministic mapping is identified, add it here.

    return { ok: true, ...results };
  },
});
