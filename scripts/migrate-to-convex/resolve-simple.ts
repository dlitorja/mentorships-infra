/**
 * Simple ID resolution using Convex REST API
 * 
 * This script resolves legacy IDs for tables where mapping is possible:
 * - payments.orderId -> orders (via orders.legacyId matching payments.orderId)
 * - sessionPacks.paymentId -> payments (via payments.legacyId matching sessionPacks.paymentId)
 * 
 * For mentorId fields: NO RESOLUTION POSSIBLE - no matching instructors exist
 * 
 * Usage:
 *   CONVEX_DEPLOYMENT_URL=http://localhost:3000 npx tsx scripts/migrate-to-convex/resolve-simple.ts
 */

const CONVEX_DEPLOYMENT_URL = process.env.CONVEX_DEPLOYMENT_URL || "http://localhost:3000";
const ADMIN_KEY = process.env.CONVEX_ADMIN_KEY || "devadmin";

async function queryTable(tableName: string) {
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
    throw new Error(`Query failed for ${tableName}: ${response.status}`);
  }

  const data = await response.json();
  return data.value || [];
}

async function patchDocument(tableName: string, docId: string, updates: Record<string, unknown>) {
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
    console.log(`  Warning: Patch failed for ${tableName}/${docId}: ${text.substring(0, 100)}`);
    return false;
  }
  return true;
}

async function main() {
  console.log("\n=== Legacy ID Resolution ===\n");
  console.log(`Deployment: ${CONVEX_DEPLOYMENT_URL}\n`);

  try {
    // Step 1: Query all relevant tables
    console.log("Fetching data from Convex...");
    const [orders, payments, sessionPacks] = await Promise.all([
      queryTable("orders"),
      queryTable("payments"),
      queryTable("sessionPacks"),
    ]);

    console.log(`  Orders: ${orders.length}`);
    console.log(`  Payments: ${payments.length}`);
    console.log(`  SessionPacks: ${sessionPacks.length}`);

    // Step 2: Build legacyId -> docId maps
    console.log("\nBuilding legacy ID maps...");

    const ordersByLegacyId = new Map<string, string>();
    for (const order of orders) {
      if (order.legacyId) {
        ordersByLegacyId.set(order.legacyId, order._id);
      }
    }
    console.log(`  Orders map: ${ordersByLegacyId.size} entries`);

    const paymentsByLegacyId = new Map<string, string>();
    for (const payment of payments) {
      if (payment.legacyId) {
        paymentsByLegacyId.set(payment.legacyId, payment._id);
      }
    }
    console.log(`  Payments map: ${paymentsByLegacyId.size} entries`);

    // Step 3: Resolve payments.orderId
    console.log("\nResolving payments.orderId...");
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
        console.log(`  Payment ${payment._id}: WARNING - no order found for ${payment.orderId}`);
        paymentsFailed++;
      }
    }
    console.log(`  Result: ${paymentsResolved} resolved, ${paymentsFailed} failed`);

    // Step 4: Resolve sessionPacks.paymentId
    console.log("\nResolving sessionPacks.paymentId...");
    let spResolved = 0;
    let spFailed = 0;

    for (const sp of sessionPacks) {
      const targetPaymentId = paymentsByLegacyId.get(sp.paymentId as string);
      if (targetPaymentId) {
        const success = await patchDocument("sessionPacks", sp._id, { paymentId: targetPaymentId });
        if (success) {
          console.log(`  SessionPack ${sp._id}: ${sp.paymentId} -> ${targetPaymentId}`);
          spResolved++;
        }
      } else {
        console.log(`  SessionPack ${sp._id}: WARNING - no payment found for ${sp.paymentId}`);
        spFailed++;
      }
    }
    console.log(`  Result: ${spResolved} resolved, ${spFailed} failed`);

    // Step 5: Note about mentorId fields
    console.log("\n=== mentorId Resolution Status ===");
    console.log("  sessionPacks.mentorId: CANNOT RESOLVE - no matching instructor");
    console.log("  seatReservations.mentorId: CANNOT RESOLVE - no matching instructor");
    console.log("\n  These fields will remain as legacy UUID strings.");
    console.log("  Schema will need to keep v.string() for these fields.");

    console.log("\n=== Resolution Complete ===\n");
    console.log(`payments.orderId: ${paymentsResolved} resolved, ${paymentsFailed} failed`);
    console.log(`sessionPacks.paymentId: ${spResolved} resolved, ${spFailed} failed`);

  } catch (error) {
    console.error("\n❌ Resolution failed:", error);
    process.exit(1);
  }
}

main();