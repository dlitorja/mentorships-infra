import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const inventoryChangedEventSchema = z.object({
  name: z.literal("inventory/changed"),
  data: z.object({
    instructorSlug: z.string(),
    type: z.enum(["one-on-one", "group"]),
    previousInventory: z.number().int().min(0),
    newInventory: z.number().int().min(-1),
    quantity: z.number().int().positive(),
  }),
});

type InventoryChangedEvent = z.infer<typeof inventoryChangedEventSchema>;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const handleInventoryChanged = inngest.createFunction(
  {
    id: "handle-inventory-changed",
    retries: 3,
  },
  { event: "inventory/changed" },
  async ({ event }) => {
    const parsedEvent = inventoryChangedEventSchema.parse(event) as InventoryChangedEvent;
    const { instructorSlug, type, newInventory, quantity } = parsedEvent.data;

    console.log(`Inventory changed for ${instructorSlug}/${type}: ${quantity} decremented, new count: ${newInventory}`);

    if (newInventory > 0) {
      return {
        message: "Inventory still available, no waitlist action needed",
        instructorSlug,
        type,
        newInventory,
      };
    }

    console.log(`Inventory exhausted for ${instructorSlug}/${type}, triggering waitlist notifications`);

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(`Supabase not configured: NEXT_PUBLIC_SUPABASE_URL=${!!supabaseUrl}, NEXT_PUBLIC_SUPABASE_ANON_KEY=${!!supabaseAnonKey}`);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: waitlistEntries, error } = await supabase
      .from("marketing_waitlist")
      .select("id, email")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .or(`notified.is.false,last_notification_at.lt.${oneWeekAgo}`);

    if (error) {
      console.error("Error fetching waitlist:", error);
      throw error;
    }

    const entries = waitlistEntries || [];
    
    if (entries.length === 0) {
      return {
        message: "Inventory exhausted but no waitlist entries to notify",
        instructorSlug,
        type,
        newInventory,
        notifiedCount: 0,
      };
    }

    const uniqueEmailSet = new Set<string>();
    const idsToUpdate: string[] = [];
    
    for (const entry of entries) {
      if (entry.email && !uniqueEmailSet.has(entry.email)) {
        uniqueEmailSet.add(entry.email);
        if (entry.id) {
          idsToUpdate.push(entry.id);
        }
      }
    }

    if (idsToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("marketing_waitlist")
        .update({
          notified: true,
          last_notification_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in("id", idsToUpdate);

      if (updateError) {
        console.error("Error updating waitlist entries:", updateError);
        throw updateError;
      }
    }

    return {
      message: `Inventory exhausted, marked ${idsToUpdate.length} people for notification`,
      instructorSlug,
      type,
      newInventory,
      notifiedCount: idsToUpdate.length,
    };
  }
);
