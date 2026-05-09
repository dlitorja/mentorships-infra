/**
 * Resolve Legacy IDs to Convex Document IDs
 * 
 * This script resolves v.string() fields that contain legacy UUIDs
 * to actual Convex document IDs after migration.
 * 
 * Run with: npx tsx scripts/migrate-to-convex/resolve-legacy-ids.ts
 */

import { convexHost, convexPort } from "../convex.config";
import fetch from "node-fetch";

const CONVEX_DEPLOYMENT_URL = process.env.CONVEX_DEPLOYMENT_URL || `http://${convexHost || "localhost"}:${convexPort || 3000}`;

interface ConvexDocument {
  _id: string;
  _creationTime: number;
  [key: string]: unknown;
}

interface ConvexQueryResponse {
  cursor: string | null;
  value: ConvexDocument[];
}

async function convexQuery<T = ConvexDocument>(
  tableName: string,
  deploymentUrl: string,
  adminKey: string
): Promise<T[]> {
  const response = await fetch(`${deploymentUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
    },
    body: JSON.stringify({
      query: {
        type: "NamedQuery",
        name: `${tableName}:list`,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Query failed for ${tableName}: ${response.status} ${text}`);
  }

  const data = await response.json() as ConvexQueryResponse;
  return data.value as T[];
}

async function convexPatch(
  tableName: string,
  docId: string,
  updates: Record<string, unknown>,
  deploymentUrl: string,
  adminKey: string
): Promise<void> {
  const response = await fetch(`${deploymentUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey}`,
    },
    body: JSON.stringify({
      mutation: {
        type: "NamedMutation",
        name: `${tableName}:update`,
        args: { id: docId, ...updates },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Patch failed for ${tableName}/${docId}: ${response.status} ${text}`);
  }
}

async function main() {
  const deploymentUrl = CONVEX_DEPLOYMENT_URL;
  // Use a dummy admin key for local dev - Convex dev allows local access
  const adminKey = process.env.CONVEX_ADMIN_KEY || "devadmin";

  console.log("\n=== Resolving Legacy IDs to Convex Document IDs ===\n");
  console.log(`Deployment: ${deploymentUrl}\n");

  // Step 1: Build maps from legacyId to Convex doc ID
  console.log("Step 1: Building legacy ID maps...\n");

  // Query all relevant tables
  const [orders, payments, instructors, sessionPacks, seatReservations] = await Promise.all([
    convexQuery<ConvexDocument & { legacyId?: string }>("orders", deploymentUrl, adminKey),
    convexQuery<ConvexDocument & { legacyId?: string; orderId: string }>("payments", deploymentUrl, adminKey),
    convexQuery<ConvexDocument & { legacyId?: string }>("instructors", deploymentUrl, adminKey),
    convexQuery<ConvexDocument & { legacyId?: string; mentorId: string; paymentId: string }>("sessionPacks", deploymentUrl, adminKey),
    convexQuery<ConvexDocument & { legacyId?: string; mentorId: string; sessionPackId: string }>("seatReservations", deploymentUrl, adminKey),
  ]);

  // Build legacyId -> docId maps
  const ordersByLegacyId = new Map<string, string>();
  for (const order of orders) {
    if (order.legacyId) {
      ordersByLegacyId.set(order.legacyId, order._id);
    }
  }

  const paymentsByLegacyId = new Map<string, string>();
  for (const payment of payments) {
    if (payment.legacyId) {
      paymentsByLegacyId.set(payment.legacyId, payment._id);
    }
  }

  const instructorsByLegacyId = new Map<string, string>();
  for (const instructor of instructors) {
    if (instructor.legacyId) {
      instructorsByLegacyId.set(instructor.legacyId, instructor._id);
    }
  }

  const sessionPacksByLegacyId = new Map<string, string>();
  for (const sp of sessionPacks) {
    if (sp.legacyId) {
      sessionPacksByLegacyId.set(sp.legacyId, sp._id);
    }
  }

  console.log(`  Orders: ${orders.length} (${ordersByLegacyId.size} with legacyId)`);
  console.log(`  Payments: ${payments.length} (${paymentsByLegacyId.size} with legacyId)`);
  console.log(`  Instructors: ${instructors.length} (${instructorsByLegacyId.size} with legacyId)`);
  console.log(`  SessionPacks: ${sessionPacks.length} (${sessionPacksByLegacyId.size} with legacyId)`);
  console.log(`  SeatReservations: ${seatReservations.length}`);

  // Step 2: Resolve payments.orderId
  console.log("\nStep 2: Resolving payments.orderId...\n");
  let paymentsResolved = 0;
  let paymentsFailed = 0;

  for (const payment of payments) {
    const orderDocId = ordersByLegacyId.get(payment.orderId);
    if (orderDocId) {
      console.log(`  Payment ${payment._id}: orderId ${payment.orderId} -> ${orderDocId}`);
      await convexPatch("payments", payment._id, { orderId: orderDocId }, deploymentUrl, adminKey);
      paymentsResolved++;
    } else {
      console.log(`  Payment ${payment._id}: WARNING - no order found for orderId ${payment.orderId}`);
      paymentsFailed++;
    }
  }
  console.log(`  Resolved: ${paymentsResolved}, Failed: ${paymentsFailed}`);

  // Step 3: Resolve sessionPacks
  console.log("\nStep 3: Resolving sessionPacks...\n");
  let sessionPacksResolved = 0;
  let sessionPacksFailed = 0;

  for (const sp of sessionPacks) {
    // Resolve mentorId
    const instructorDocId = instructorsByLegacyId.get(sp.mentorId);
    
    // Resolve paymentId  
    const paymentDocId = paymentsByLegacyId.get(sp.paymentId);

    const updates: Record<string, string> = {};
    
    if (instructorDocId) {
      updates.mentorId = instructorDocId;
      console.log(`  SessionPack ${sp._id}: mentorId ${sp.mentorId} -> ${instructorDocId}`);
    } else {
      console.log(`  SessionPack ${sp._id}: WARNING - no instructor found for mentorId ${sp.mentorId}`);
    }
    
    if (paymentDocId) {
      updates.paymentId = paymentDocId;
      console.log(`  SessionPack ${sp._id}: paymentId ${sp.paymentId} -> ${paymentDocId}`);
    } else {
      console.log(`  SessionPack ${sp._id}: WARNING - no payment found for paymentId ${sp.paymentId}`);
    }

    if (Object.keys(updates).length > 0) {
      await convexPatch("sessionPacks", sp._id, updates, deploymentUrl, adminKey);
      sessionPacksResolved++;
    } else {
      sessionPacksFailed++;
    }
  }
  console.log(`  Resolved: ${sessionPacksResolved}, Failed: ${sessionPacksFailed}`);

  // Step 4: Resolve seatReservations
  console.log("\nStep 4: Resolving seatReservations...\n");
  let seatReservationsResolved = 0;
  let seatReservationsFailed = 0;

  for (const sr of seatReservations) {
    const instructorDocId = instructorsByLegacyId.get(sr.mentorId);
    const sessionPackDocId = sessionPacksByLegacyId.get(sr.sessionPackId);

    const updates: Record<string, string> = {};

    if (instructorDocId) {
      updates.mentorId = instructorDocId;
      console.log(`  SeatReservation ${sr._id}: mentorId ${sr.mentorId} -> ${instructorDocId}`);
    } else {
      console.log(`  SeatReservation ${sr._id}: WARNING - no instructor found for mentorId ${sr.mentorId}`);
    }

    if (sessionPackDocId) {
      updates.sessionPackId = sessionPackDocId;
      console.log(`  SeatReservation ${sr._id}: sessionPackId ${sr.sessionPackId} -> ${sessionPackDocId}`);
    } else {
      console.log(`  SeatReservation ${sr._id}: WARNING - no sessionPack found for sessionPackId ${sr.sessionPackId}`);
    }

    if (Object.keys(updates).length > 0) {
      await convexPatch("seatReservations", sr._id, updates, deploymentUrl, adminKey);
      seatReservationsResolved++;
    } else {
      seatReservationsFailed++;
    }
  }
  console.log(`  Resolved: ${seatReservationsResolved}, Failed: ${seatReservationsFailed}`);

  // Summary
  console.log("\n=== Resolution Complete ===\n");
  console.log(`payments.orderId: ${paymentsResolved} resolved, ${paymentsFailed} failed`);
  console.log(`sessionPacks: ${sessionPacksResolved} resolved, ${sessionPacksFailed} failed`);
  console.log(`seatReservations: ${seatReservationsResolved} resolved, ${seatReservationsFailed} failed`);

  if (paymentsFailed > 0 || sessionPacksFailed > 0 || seatReservationsFailed > 0) {
    console.log("\n⚠️  Some IDs could not be resolved. Check the warnings above.");
    console.log("   This is expected if the referenced documents don't exist in Convex.");
  }
}

main().catch((error) => {
  console.error("\n❌ Resolution failed:", error);
  process.exit(1);
});