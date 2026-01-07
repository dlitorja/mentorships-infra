import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const INSTRUCTORS_WITH_ONE = [
  "nino-vecia",
  "neil-gray",
  "andrea-sipl",
  "rakasa",
];

const instructors = [
  "jordan-jardine",
  "cameron-nissen",
  "nino-vecia",
  "oliver-titley",
  "malina-dowling",
  "rakasa",
  "amanda-kiefer",
  "neil-gray",
  "ash-kirk",
  "andrea-sipl",
  "kimea-zizzari",
  "keven-mallqui",
];

async function setInitialInventory() {
  console.log("Setting initial inventory...\n");

  for (const slug of instructors) {
    const oneOnOneCount = INSTRUCTORS_WITH_ONE.includes(slug) ? 1 : 3;
    const groupCount = 0; // Default to 0 for now

    console.log(`${slug}: 1-on-1 = ${oneOnOneCount}, Group = ${groupCount}`);

    // Upsert the inventory record
    const { data, error } = await supabase
      .from("instructor_inventory")
      .upsert(
        {
          instructor_slug: slug,
          one_on_one_inventory: oneOnOneCount,
          group_inventory: groupCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instructor_slug" }
      )
      .select();

    if (error) {
      console.error(`  Error: ${error.message}`);
    } else {
      console.log(`  Updated successfully`);
    }
  }

  console.log("\nDone!");
}

setInitialInventory().catch(console.error);
