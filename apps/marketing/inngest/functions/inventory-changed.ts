import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const handleInventoryChanged = inngest.createFunction(
  {
    id: "handle-inventory-changed",
    retries: 3,
  },
  { event: "inventory/changed" },
  async ({ event }) => {
    const { instructorSlug, type, previousInventory, newInventory, quantity } = event.data;

    console.log(`Inventory changed for ${instructorSlug}/${type}: ${previousInventory} -> ${newInventory} (decremented by ${quantity})`);

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
      throw new Error("Supabase not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: waitlistEntries, error } = await supabase
      .from("marketing_waitlist")
      .select("id, email")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .or(`notified.eq.false,last_notification_at.lt.${oneWeekAgo}`);

    if (error) {
      console.error("Error fetching waitlist:", error);
      throw error;
    }

    const uniqueEmails = [...new Set(waitlistEntries?.map((entry) => entry.email) || [])];

    if (uniqueEmails.length === 0) {
      return {
        message: "Inventory exhausted but no waitlist entries to notify",
        instructorSlug,
        type,
        newInventory,
        notifiedCount: 0,
      };
    }

    const { data: matchingRows, error: selectError } = await supabase
      .from("marketing_waitlist")
      .select("id, email")
      .in("email", uniqueEmails)
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type);

    if (selectError) {
      console.error("Error fetching matching rows:", selectError);
      throw selectError;
    }

    const idsToUpdate = matchingRows?.map((row) => row.id).filter(Boolean) || [];

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
