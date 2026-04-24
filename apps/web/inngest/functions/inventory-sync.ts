import { inngest } from "../client";

const CONVEX_HTTP_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_HTTP_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

export const syncInstructorInventoryToConvex = inngest.createFunction(
  {
    id: "sync-instructor-inventory-to-convex",
    name: "Sync Instructor Inventory to Convex",
    retries: 3,
  },
  { event: "instructor/created" },
  async ({ event, step }) => {
    const { slug, name, email, oneOnOneInventory, groupInventory, maxActiveStudents } = event.data;

    return await step.run("sync-inventory-to-convex", async () => {
      const url = `${CONVEX_HTTP_URL}/api/inventory/admin-sync`;
      
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
        body: JSON.stringify({
          slug,
          name,
          email,
          oneOnOneInventory,
          groupInventory,
          maxActiveStudents,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Convex sync failed (${res.status}): ${err}`);
      }

      const data = await res.json();
      return { success: true, ...data };
    });
  }
);

export const syncInstructorInventoryToConvexUpdated = inngest.createFunction(
  {
    id: "sync-instructor-inventory-to-convex-updated",
    name: "Sync Instructor Inventory Updated to Convex",
    retries: 3,
  },
  { event: "instructor/updated" },
  async ({ event, step }) => {
    const { slug, name, email, oneOnOneInventory, groupInventory, maxActiveStudents } = event.data;

    return await step.run("sync-inventory-to-convex", async () => {
      const url = `${CONVEX_HTTP_URL}/api/inventory/admin-sync`;
      
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
        body: JSON.stringify({
          slug,
          name,
          email,
          oneOnOneInventory,
          groupInventory,
          maxActiveStudents,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Convex sync failed (${res.status}): ${err}`);
      }

      const data = await res.json();
      return { success: true, ...data };
    });
  }
);