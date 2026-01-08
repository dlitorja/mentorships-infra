import { createClient } from "@supabase/supabase-js";
import type { WeeklyDigestData } from "@/lib/email/weekly-digest";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface InventoryChangeLog {
  id: string;
  instructor_slug: string;
  mentorship_type: "one-on-one" | "group" | null;
  change_type: "manual_update" | "kajabi_purchase";
  old_value: number;
  new_value: number;
  changed_at: string;
}

export async function getWeeklyDigestData(
  periodStart: Date,
  periodEnd: Date
): Promise<WeeklyDigestData> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase not configured");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();

  const instructors = await supabase
    .from("instructor_inventory")
    .select("instructor_slug, instructor_name, one_on_one_inventory, group_inventory");

  if (instructors.error) {
    console.error("Error fetching instructors:", instructors.error);
    throw instructors.error;
  }

  const inventoryStatus = (instructors.data || []).map((inv) => ({
    instructorName: inv.instructor_name,
    oneOnOneInventory: inv.one_on_one_inventory ?? 0,
    groupInventory: inv.group_inventory ?? 0,
  }));

  const waitlistSignups = await supabase
    .from("marketing_waitlist")
    .select("instructor_slug, mentorship_type, email, created_at")
    .gte("created_at", periodStartIso)
    .lte("created_at", periodEndIso)
    .order("created_at", { ascending: false });

  if (waitlistSignups.error) {
    console.error("Error fetching waitlist signups:", waitlistSignups.error);
    throw waitlistSignups.error;
  }

  const formattedSignups = (waitlistSignups.data || []).map((signup) => {
    const instructor = inventoryStatus.find((inv) =>
      signup.instructor_slug.includes(inv.instructorName.toLowerCase().replace(/\s+/g, "-"))
    );
    return {
      instructorName: instructor?.instructorName || signup.instructor_slug,
      mentorshipType: signup.mentorship_type,
      email: signup.email,
      createdAt: signup.created_at,
    };
  });

  const inventoryChanges = await supabase
    .from("inventory_change_log")
    .select("*")
    .gte("changed_at", periodStartIso)
    .lte("changed_at", periodEndIso)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (inventoryChanges.error) {
    console.error("Error fetching inventory changes:", inventoryChanges.error);
    throw inventoryChanges.error;
  }

  const formattedChanges = (inventoryChanges.data || []).map((change: InventoryChangeLog) => {
    const instructor = inventoryStatus.find((inv) =>
      change.instructor_slug.includes(inv.instructorName.toLowerCase().replace(/\s+/g, "-"))
    );
    return {
      instructorName: instructor?.instructorName || change.instructor_slug,
      type: change.change_type,
      mentorshipType: change.mentorship_type || null,
      before: change.old_value,
      after: change.new_value,
      changedAt: change.changed_at,
    };
  });

  const notificationsSent = await supabase
    .from("marketing_waitlist")
    .select("instructor_slug, mentorship_type, last_notification_at")
    .gte("last_notification_at", periodStartIso)
    .lte("last_notification_at", periodEndIso)
    .order("last_notification_at", { ascending: false });

  if (notificationsSent.error) {
    console.error("Error fetching notifications:", notificationsSent.error);
    throw notificationsSent.error;
  }

  const notificationsByInstructor = new Map<string, { count: number; sentAt: string }>();
  (notificationsSent.data || []).forEach((notif) => {
    const key = `${notif.instructor_slug}|${notif.mentorship_type}`;
    if (!notificationsByInstructor.has(key)) {
      notificationsByInstructor.set(key, { count: 0, sentAt: notif.last_notification_at });
    }
    notificationsByInstructor.get(key)!.count++;
  });

  const formattedNotifications = Array.from(notificationsByInstructor.entries()).map(([key, data]) => {
    const [instructorSlug, mentorshipType] = key.split("|") as [string, "one-on-one" | "group"];
    const instructor = inventoryStatus.find((inv) =>
      instructorSlug.includes(inv.instructorName.toLowerCase().replace(/\s+/g, "-"))
    );
    return {
      instructorName: instructor?.instructorName || instructorSlug,
      mentorshipType,
      count: data.count,
      sentAt: data.sentAt,
    };
  });

  const conversions: WeeklyDigestData["conversions"] = [];

  return {
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    waitlistSignups: formattedSignups,
    inventoryStatus,
    notificationsSent: formattedNotifications,
    inventoryChanges: formattedChanges,
    conversions,
  };
}

export function getPeriodForDigest(
  frequency: "daily" | "weekly" | "monthly",
  baseDate: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(baseDate);
  const start = new Date(baseDate);

  switch (frequency) {
    case "daily":
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "weekly":
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case "monthly":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
}
