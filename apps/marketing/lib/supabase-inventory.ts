import { createClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getInstructorInventory(slug: string) {
  const { data, error } = await supabase
    .from("instructor_inventory")
    .select("one_on_one_inventory, group_inventory")
    .eq("instructor_slug", slug)
    .single();

  if (error) {
    console.error("Error fetching inventory:", error);
    return null;
  }

  return data;
}

export async function updateInventory(
  slug: string,
  updates: { one_on_one_inventory?: number; group_inventory?: number },
  updatedBy?: string
) {
  let current = await getInstructorInventory(slug);

  if (!current) {
    const { data: insertData, error: insertError } = await supabase
      .from("instructor_inventory")
      .insert({
        instructor_slug: slug,
        one_on_one_inventory: 0,
        group_inventory: 0,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: refetchedData, error: refetchError } = await supabase
          .from("instructor_inventory")
          .select()
          .eq("instructor_slug", slug)
          .single();
        
        if (refetchError) {
          console.error("Error refetching inventory record after duplicate:", refetchError);
          return null;
        }
        
        current = refetchedData;
      } else {
        console.error("Error creating inventory record:", insertError);
        return null;
      }
    } else {
      current = insertData;
    }
  }

  const response = await fetch("/api/admin/inventory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      one_on_one_inventory: updates.one_on_one_inventory,
      group_inventory: updates.group_inventory,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Error updating inventory:", data);
    return null;
  }

  const shouldNotifyOneOnOne =
    current?.one_on_one_inventory === 0 &&
    updates.one_on_one_inventory !== undefined &&
    updates.one_on_one_inventory > 0;
  const shouldNotifyGroup =
    current?.group_inventory === 0 &&
    updates.group_inventory !== undefined &&
    updates.group_inventory > 0;

  if (shouldNotifyOneOnOne) {
    try {
      await inngest.send({
        name: "inventory/available",
        data: {
          instructorSlug: slug,
          type: "one-on-one",
          inventory: updates.one_on_one_inventory!,
        },
      });
    } catch (notifyError) {
      console.error(`Failed to send one-on-one notification for ${slug}:`, notifyError);
    }
  }

  if (shouldNotifyGroup) {
    try {
      await inngest.send({
        name: "inventory/available",
        data: {
          instructorSlug: slug,
          type: "group",
          inventory: updates.group_inventory!,
        },
      });
    } catch (notifyError) {
      console.error(`Failed to send group notification for ${slug}:`, notifyError);
    }
  }

  if (current && updates.one_on_one_inventory !== undefined && current.one_on_one_inventory !== updates.one_on_one_inventory) {
    await logInventoryChange({
      instructorSlug: slug,
      mentorshipType: "one-on-one",
      changeType: "manual_update",
      oldValue: current.one_on_one_inventory,
      newValue: updates.one_on_one_inventory,
      changedBy: updatedBy,
    });
  }
  if (current && updates.group_inventory !== undefined && current.group_inventory !== updates.group_inventory) {
    await logInventoryChange({
      instructorSlug: slug,
      mentorshipType: "group",
      changeType: "manual_update",
      oldValue: current.group_inventory,
      newValue: updates.group_inventory,
      changedBy: updatedBy,
    });
  }

  return data;
}

interface InventoryChangeLog {
  instructorSlug: string;
  mentorshipType: "one-on-one" | "group";
  changeType: "manual_update" | "kajabi_purchase";
  oldValue: number;
  newValue: number;
  changedBy?: string;
}

export async function logInventoryChange(log: InventoryChangeLog): Promise<boolean> {
  const { error } = await supabase
    .from("inventory_change_log")
    .insert({
      instructor_slug: log.instructorSlug,
      mentorship_type: log.mentorshipType,
      change_type: log.changeType,
      old_value: log.oldValue,
      new_value: log.newValue,
      changed_by: log.changedBy,
    });

  if (error) {
    console.error("Error logging inventory change:", error);
    return false;
  }
  return true;
}

export async function decrementInventory(
  slug: string,
  type: "one-on-one" | "group",
  quantity: number = 1
) {
  const column = type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";

  const { data, error } = await supabase
    .rpc("decrement_inventory", {
      slug_param: slug,
      inventory_column: column,
      decrement_by: quantity,
    });

  if (error) {
    console.error("Error decrementing inventory:", error);
    return false;
  }

  return data;
}

export async function addToWaitlist(
  email: string,
  instructorSlug: string,
  type: "one-on-one" | "group"
) {
  try {
    const response = await fetch("/api/waitlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        instructorSlug,
        type,
      }),
    });

    const result = await response.json();

    if (result.success === true && result.alreadyOnWaitlist === true) {
      return { alreadyOnWaitlist: true };
    }

    if (!response.ok) {
      console.error("Error adding to waitlist:", result);
      return null;
    }

    return result;
  } catch (error) {
    console.error("Error adding to waitlist:", error);
    return null;
  }
}

export async function getWaitlistStatus(
  email: string,
  instructorSlug: string,
  type?: "one-on-one" | "group"
) {
  let query = supabase
    .from("marketing_waitlist")
    .select("*")
    .eq("email", email)
    .eq("instructor_slug", instructorSlug);

  if (type) {
    query = query.eq("mentorship_type", type);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error checking waitlist status:", error);
    return null;
  }

  return data;
}

export async function getKajabiOfferMapping(offerId: string) {
  const { data, error } = await supabase
    .from("kajabi_offer_mappings")
    .select("*")
    .eq("offer_id", offerId)
    .single();

  if (error) {
    console.error("Error fetching offer mapping:", error);
    return null;
  }

  return data;
}

export async function getAllInstructorsWithInventory() {
  const { data, error } = await supabase
    .from("instructor_inventory")
    .select("*")
    .order("instructor_slug");

  if (error) {
    console.error("Error fetching all inventory:", error);
    return [];
  }

  return data;
}

export async function triggerWaitlistNotifications(
  instructorSlug: string,
  type: "one-on-one" | "group"
) {
  const { data, error } = await supabase
    .rpc("trigger_waitlist_notifications", {
      slug_param: instructorSlug,
      type_param: type,
    });

  if (error) {
    console.error("Error triggering notifications:", error);
    return null;
  }

  return data;
}

export async function getWaitlistForInstructor(
  instructorSlug: string,
  type: "one-on-one" | "group"
) {
  const { data, error } = await supabase
    .from("marketing_waitlist")
    .select("id, email, instructor_slug, mentorship_type, notified, created_at")
    .eq("instructor_slug", instructorSlug)
    .eq("mentorship_type", type)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching waitlist:", error);
    return [];
  }

  return data || [];
}

interface WaitlistCountEntry {
  instructor_slug: string;
  mentorship_type: string;
}

const waitlistCountEntrySchema = z.object({
  instructor_slug: z.string(),
  mentorship_type: z.string(),
});

export async function getWaitlistCounts(): Promise<Record<string, { one_on_one: number; group: number }>> {
  const { data, error } = await supabase
    .from("marketing_waitlist")
    .select("instructor_slug, mentorship_type");

  if (error) {
    console.error("Error fetching waitlist counts:", error);
    return {};
  }

  const parseResult = waitlistCountEntrySchema.array().safeParse(data || []);
  if (!parseResult.success) {
    console.error("Invalid waitlist count data:", parseResult.error);
    return {};
  }

  const counts: Record<string, { one_on_one: number; group: number }> = {};

  parseResult.data.forEach((entry) => {
    const key = entry.instructor_slug;
    if (!counts[key]) {
      counts[key] = { one_on_one: 0, group: 0 };
    }
    if (entry.mentorship_type === "one-on-one") {
      counts[key].one_on_one++;
    } else if (entry.mentorship_type === "group") {
      counts[key].group++;
    }
  });

  return counts;
}
