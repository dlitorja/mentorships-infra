import { inngest } from "../client";
import { z } from "zod";

const CONVEX_URL = process.env.CONVEX_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

const inventorySyncPayload = z.object({
  slug: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  oneOnOneInventory: z.number().optional(),
  groupInventory: z.number().optional(),
  maxActiveStudents: z.number().optional(),
});

function validateEnv() {
  if (!CONVEX_URL) {
    throw new Error("Missing CONVEX_URL environment variable. Set it to your *.convex.site deployment URL.");
  }
  if (!CONVEX_HTTP_KEY) {
    throw new Error("Missing CONVEX_HTTP_KEY environment variable.");
  }
}

async function postInventoryToConvex(data: z.infer<typeof inventorySyncPayload>) {
  validateEnv();
  const payload = inventorySyncPayload.parse(data);
  const res = await fetch(`${CONVEX_URL}/api/inventory/admin-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Convex sync failed (${res.status}): ${await res.text()}`);
  }
  return { success: true, ...(await res.json()) };
}

export const syncInstructorInventoryToConvex = inngest.createFunction(
  {
    id: "sync-instructor-inventory-to-convex",
    name: "Sync Instructor Inventory to Convex",
    retries: 3,
  },
  [{ event: "instructor/created" }, { event: "instructor/updated" }],
  async ({ event, step }) => {
    return await step.run("sync-inventory-to-convex", async () => {
      return postInventoryToConvex(event.data as z.infer<typeof inventorySyncPayload>);
    });
  }
);