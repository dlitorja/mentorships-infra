import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const instructorInventorySchema = z.object({
  one_on_one_inventory: z.number(),
  group_inventory: z.number(),
});

export type InstructorInventory = z.infer<typeof instructorInventorySchema>;

export async function getInstructorInventory(slug: string): Promise<InstructorInventory | null> {
  const { data, error } = await supabase
    .from("instructor_inventory")
    .select("one_on_one_inventory, group_inventory")
    .eq("instructor_slug", slug)
    .single();

  if (error) {
    console.error("Error fetching inventory:", error);
    return null;
  }

  const parsed = instructorInventorySchema.safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for instructor inventory:", parsed.error.format());
    return null;
  }

  return parsed.data;
}

export async function updateInventory(
  slug: string,
  updates: { one_on_one_inventory?: number; group_inventory?: number },
  updatedBy?: string
): Promise<InstructorInventory | null> {
  const { data, error } = await supabase
    .from("instructor_inventory")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq("instructor_slug", slug)
    .select("one_on_one_inventory, group_inventory")
    .single();

  if (error) {
    console.error("Error updating inventory:", error);
    return null;
  }

  const parsed = instructorInventorySchema.safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for updated inventory:", parsed.error.format());
    return null;
  }

  return parsed.data;
}

const decrementInventoryResultSchema = z.record(z.string(), z.unknown());

export async function decrementInventory(
  slug: string,
  type: "one-on-one" | "group",
  quantity: number = 1
): Promise<z.infer<typeof decrementInventoryResultSchema> | null> {
  const column = type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";

  const { data, error } = await supabase
    .rpc("decrement_inventory", {
      slug_param: slug,
      inventory_column: column,
      decrement_by: quantity,
    });

  if (error) {
    console.error("Error decrementing inventory:", error);
    return null;
  }

  return data;
}

export async function addToWaitlist(
  email: string,
  instructorSlug: string,
  type: "one-on-one" | "group"
) {
  const { data, error } = await supabase
    .from("marketing_waitlist")
    .insert({
      email,
      instructor_slug: instructorSlug,
      mentorship_type: type,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { alreadyOnWaitlist: true };
    }
    console.error("Error adding to waitlist:", error);
    return null;
  }

  return data;
}

const waitlistEntrySchema = z.object({
  id: z.number(),
  email: z.string(),
  instructor_slug: z.string(),
  mentorship_type: z.string(),
  notified: z.boolean(),
  created_at: z.string(),
});

type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

export async function getWaitlistStatus(
  email: string,
  instructorSlug: string,
  type?: "one-on-one" | "group"
): Promise<WaitlistEntry[] | null> {
  let query = supabase
    .from("marketing_waitlist")
    .select("id, email, instructor_slug, mentorship_type, notified, created_at")
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

  const parsed = waitlistEntrySchema.array().safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for waitlist status:", parsed.error.format());
    return null;
  }

  return parsed.data;
}

const kajabiOfferMappingSchema = z.object({
  id: z.number(),
  offer_id: z.string(),
  instructor_slug: z.string().nullable(),
  product_id: z.string().nullable(),
  offer_type: z.string().nullable(),
  created_at: z.string(),
});

type KajabiOfferMapping = z.infer<typeof kajabiOfferMappingSchema>;

export async function getKajabiOfferMapping(offerId: string): Promise<KajabiOfferMapping | null> {
  const { data, error } = await supabase
    .from("kajabi_offer_mappings")
    .select("id, offer_id, instructor_slug, product_id, offer_type, created_at")
    .eq("offer_id", offerId)
    .single();

  if (error) {
    console.error("Error fetching offer mapping:", error);
    return null;
  }

  const parsed = kajabiOfferMappingSchema.safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for kajabi offer mapping:", parsed.error.format());
    return null;
  }

  return parsed.data;
}

export async function getAllInstructorsWithInventory(): Promise<InstructorInventory[] | null> {
  const { data, error } = await supabase
    .from("instructor_inventory")
    .select("id, instructor_slug, one_on_one_inventory, group_inventory")
    .order("instructor_slug");

  if (error) {
    console.error("Error fetching all inventory:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  const parsed = instructorInventorySchema.array().safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for all inventory:", parsed.error.format());
    return null;
  }

  return parsed.data;
}

export async function triggerWaitlistNotifications(
  instructorSlug: string,
  type: "one-on-one" | "group"
): Promise<unknown | null> {
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
): Promise<WaitlistEntry[] | null> {
  const { data, error } = await supabase
    .from("marketing_waitlist")
    .select("id, email, instructor_slug, mentorship_type, notified, created_at")
    .eq("instructor_slug", instructorSlug)
    .eq("mentorship_type", type)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching waitlist:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  const parsed = waitlistEntrySchema.array().safeParse(data);
  if (!parsed.success) {
    console.error("Validation error for instructor waitlist:", parsed.error.format());
    return null;
  }

  return parsed.data;
}
