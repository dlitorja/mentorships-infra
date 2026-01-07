import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const processWaitlistNotifications = inngest.createFunction(
  {
    id: "process-waitlist-notifications",
    retries: 3,
  },
  { event: "waitlist/notify-users" },
  async ({ event }) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { instructorSlug, type } = event.data;

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
      return { message: "No entries to notify", count: 0 };
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
      message: `Marked ${idsToUpdate.length} people for notification`,
      count: idsToUpdate.length,
      instructorSlug,
      type,
    };
  }
);
