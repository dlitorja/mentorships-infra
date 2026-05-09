/**
 * Full Legacy ID Resolution using Convex REST API
 * 
 * Resolves all legacy UUID fields to actual Convex document IDs.
 * 
 * Usage:
 *   npx tsx scripts/migrate-to-convex/resolve-full.ts
 */

import fetch from "node-fetch";

const CONVEX_DEPLOYMENT_URL = "http://localhost:3210";
const ADMIN_KEY = "devadmin";

interface ConvexDoc {
  _id: string;
  _creationTime: number;
  legacyId?: string;
  [key: string]: unknown;
}

interface QueryResult {
  cursor: string | null;
  value: ConvexDoc[];
}

async function queryTable(tableName: string): Promise<ConvexDoc[]> {
  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
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
    throw new Error(`Query failed for ${tableName}: ${response.status} ${text.substring(0, 200)}`);
  }

  const data = await response.json() as QueryResult;
  return data.value || [];
}

async function patchDocument(tableName: string, docId: string, updates: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
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
    console.log(`  Warning: Patch failed for ${tableName}/${docId}: ${text.substring(0, 150)}`);
    return false;
  }
  return true;
}

async function main() {
  console.log("\n=== Full Legacy ID Resolution ===\n");

  try {
    // Step 1: Query all relevant tables
    console.log("Fetching data from Convex...");
    const [orders, payments, instructors, sessionPacks, seatReservations] = await Promise.all([
      queryTable("orders"),
      queryTable("payments"),
      queryTable("instructors"),
      queryTable("sessionPacks"),
      queryTable("seatReservations"),
    ]);

    console.log(`  Orders: ${orders.length}`);
    console.log(`  Payments: ${payments.length}`);
    console.log(`  Instructors: ${instructors.length}`);
    console.log(`  SessionPacks: ${sessionPacks.length}`);
    console.log(`  SeatReservations: ${seatReservations.length}`);

    // Step 2: Build legacyId -> docId maps
    console.log("\nBuilding legacy ID maps...");

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

    console.log(`  Orders map: ${ordersByLegacyId.size} entries`);
    console.log(`  Payments map: ${paymentsByLegacyId.size} entries`);
    console.log(`  Instructors map: ${instructorsByLegacyId.size} entries`);
    console.log(`  SessionPacks map: ${sessionPacksByLegacyId.size} entries`);

    // Debug: show instructor legacy IDs
    console.log("\n  Instructor legacy IDs:");
    for (const [legacyId, docId] of instructorsByLegacyId) {
      console.log(`    ${legacyId} -> ${docId}`);
    }

    // Step 3: Resolve payments.orderId
    console.log("\n--- Resolving payments.orderId ---");
    let paymentsResolved = 0;
    let paymentsFailed = 0;

    for (const payment of payments) {
      const targetOrderId = ordersByLegacyId.get(payment.orderId as string);
      if (targetOrderId) {
        const success = await patchDocument("payments", payment._id, { orderId: targetOrderId });
        if (success) {
          console.log(`  Payment ${payment._id}: ${payment.orderId} -> ${targetOrderId}`);
          paymentsResolved++;
        }
      } else {
        console.log(`  Payment ${payment._id}: WARNING - no order for ${payment.orderId}`);
        paymentsFailed++;
      }
    }
    console.log(`  Result: ${paymentsResolved} resolved, ${paymentsFailed} failed`);

    // Step 4: Resolve sessionPacks
    console.log("\n--- Resolving sessionPacks ---");
    let spResolved = 0;
    let spFailed = 0;

    for (const sp of sessionPacks) {
      const updates: Record<string, string> = {};
      let hasUpdates = false;

      // Resolve mentorId
      const targetInstructorId = instructorsByLegacyId.get(sp.mentorId as string);
      if (targetInstructorId) {
        updates.mentorId = targetInstructorId;
        hasUpdates = true;
        console.log(`  SessionPack ${sp._id}: mentorId ${sp.mentorId} -> ${targetInstructorId}`);
      } else {
        console.log(`  SessionPack ${sp._id}: WARNING - no instructor for mentorId ${sp.mentorId}`);
      }

      // Resolve paymentId
      const targetPaymentId = paymentsByLegacyId.get(sp.paymentId as string);
      if (targetPaymentId) {
        updates.paymentId = targetPaymentId;
        hasUpdates = true;
        console.log(`  SessionPack ${sp._id}: paymentId ${sp.paymentId} -> ${targetPaymentId}`);
      } else {
        console.log(`  SessionPack ${sp._id}: WARNING - no payment for paymentId ${sp.paymentId}`);
      }

      if (hasUpdates) {
        const success = await patchDocument("sessionPacks", sp._id, updates);
        if (success) spResolved++;
      } else {
        spFailed++;
      }
    }
    console.log(`  Result: ${spResolved} resolved, ${spFailed} failed`);

    // Step 5: Resolve seatReservations
    console.log("\n--- Resolving seatReservations ---");
    let srResolved = 0;
    let srFailed = 0;

    for (const sr of seatReservations) {
      const updates: Record<string, string> = {};
      let hasUpdates = false;

      // Resolve mentorId
      const targetInstructorId = instructorsByLegacyId.get(sr.mentorId as string);
      if (targetInstructorId) {
        updates.mentorId = targetInstructorId;
        hasUpdates = true;
        console.log(`  SeatReservation ${sr._id}: mentorId ${sr.mentorId} -> ${targetInstructorId}`);
      } else {
        console.log(`  SeatReservation ${sr._id}: WARNING - no instructor for mentorId ${sr.mentorId}`);
      }

      // Resolve sessionPackId
      const targetSessionPackId = sessionPacksByLegacyId.get(sr.sessionPackId as string);
      if (targetSessionPackId) {
        updates.sessionPackId = targetSessionPackId;
        hasUpdates = true;
        console.log(`  SeatReservation ${sr._id}: sessionPackId ${sr.sessionPackId} -> ${targetSessionPackId}`);
      } else {
        console.log(`  SeatReservation ${sr._id}: WARNING - no sessionPack for sessionPackId ${sr.sessionPackId}`);
      }

      if (hasUpdates) {
        const success = await patchDocument("seatReservations", sr._id, updates);
        if (success) srResolved++;
      } else {
        srFailed++;
      }
    }
    console.log(`  Result: ${srResolved} resolved, ${srFailed} failed`);

    // Summary
    console.log("\n=== Resolution Complete ===\n");
    console.log(`payments.orderId: ${paymentsResolved} resolved, ${paymentsFailed} failed`);
    console.log(`sessionPacks (mentorId, paymentId): ${spResolved} resolved, ${spFailed} failed`);
    console.log(`seatReservations (mentorId, sessionPackId): ${srResolved} resolved, ${srFailed} failed`);

    const totalFailed = paymentsFailed + spFailed + srFailed;
    if (totalFailed > 0) {
      console.log(`\n⚠️  Total failures: ${totalFailed}`);
    } else {
      console.log("\n✅ All IDs resolved successfully!");
    }

  } catch (error) {
    console.error("\n❌ Resolution failed:", error);
    process.exit(1);
  }
}

main();